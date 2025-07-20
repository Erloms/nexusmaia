// @ts-ignore
import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
// @ts-ignore
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.9'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// RSA2 签名和验签工具函数 (内联)
class AlipayRSAUtils {
  
  // 将 PEM 格式的私钥转换为 CryptoKey
  static async importPrivateKey(pemKey: string): Promise<CryptoKey> {
    // 清理 PEM 格式
    const pemHeader = "-----BEGIN PRIVATE KEY-----";
    const pemFooter = "-----END PRIVATE KEY-----";
    const pemContents = pemKey
      .replace(pemHeader, "")
      .replace(pemFooter, "")
      .replace(/\s/g, "");
    
    // Base64 解码
    const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
    
    // 导入私钥
    return await crypto.subtle.importKey(
      "pkcs8",
      binaryDer,
      {
        name: "RSASSA-PKCS1-v1_5",
        hash: "SHA-256",
      },
      false,
      ["sign"]
    );
  }

  // 将 PEM 格式的公钥转换为 CryptoKey
  static async importPublicKey(pemKey: string): Promise<CryptoKey> {
    // 清理 PEM 格式
    const pemHeader = "-----BEGIN PUBLIC KEY-----";
    const pemFooter = "-----END PUBLIC KEY-----";
    const pemContents = pemKey
      .replace(pemHeader, "")
      .replace(pemFooter, "")
      .replace(/\s/g, "");
    
    // Base64 解码
    const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
    
    // 导入公钥
    return await crypto.subtle.importKey(
      "spki",
      binaryDer,
      {
        name: "RSASSA-PKCS1-v1_5",
        hash: "SHA-256",
      },
      false,
      ["verify"]
    );
  }

  // 对字符串进行 RSA2 签名
  static async signRSA2(data: string, privateKey: CryptoKey): Promise<string> {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      privateKey,
      dataBuffer
    );

    // 将签名转换为 Base64
    return btoa(String.fromCharCode(...new Uint8Array(signature)));
  }

  // 验证 RSA2 签名
  static async verifyRSA2(data: string, signature: string, publicKey: CryptoKey): Promise<boolean> {
    try {
      const encoder = new TextEncoder();
      const dataBuffer = encoder.encode(data);
      
      // Base64 解码签名
      const signatureBuffer = Uint8Array.from(atob(signature), c => c.charCodeAt(0));
      
      return await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        publicKey,
        signatureBuffer,
        dataBuffer
      );
    } catch (error) {
      console.error('签名验证失败:', error);
      return false;
    }
  }

  // 构建支付宝签名字符串
  static buildSignString(params: Record<string, any>): string {
    // 过滤空值并排序
    const filteredParams = Object.keys(params)
      .filter(key => params[key] !== null && params[key] !== undefined && params[key] !== '')
      .sort()
      .reduce((result: Record<string, any>, key) => {
        result[key] = params[key];
        return result;
      }, {});

    // 构建查询字符串
    return Object.keys(filteredParams)
      .map(key => `${key}=${filteredParams[key]}`)
      .join('&');
  }
}

interface CreateOrderRequest {
  subject: string;
  total_amount: number;
  product_id: string;
}

serve(async (req) => {
  console.log('Edge Function create-alipay-order started for request:', req.url);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      // @ts-ignore
      Deno.env.get('SUPABASE_URL') ?? '',
      // @ts-ignore
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    let requestBody: CreateOrderRequest;
    let rawBody: string;
    try {
      rawBody = await req.text();
      requestBody = JSON.parse(rawBody);
    } catch (parseError) {
      console.error('JSON parsing error:', parseError, 'Raw body:', rawBody);
      return new Response(
        JSON.stringify({ error: `Invalid JSON in request body: ${parseError.message}. Raw body: ${rawBody}` }),
        { 
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    const { subject, total_amount, product_id } = requestBody;
    console.log('Received request for order creation:', { subject, total_amount, product_id });

    if (!subject || total_amount === undefined || total_amount === null || !product_id) {
      console.error('Missing required parameters in request body:', { subject, total_amount, product_id });
      return new Response(
        JSON.stringify({ error: 'Subject, total_amount, and product_id are required' }),
        { 
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error('Missing Authorization header');
      throw new Error('缺少认证信息');
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    
    if (userError || !user) {
      console.error('User authentication failed:', userError);
      throw new Error('用户认证失败');
    }
    console.log('Authenticated user:', user.id);

    const { data: config, error: configError } = await supabaseClient
      .from('payment_configs')
      .select('*')
      .eq('id', 'alipay_config')
      .single();

    if (configError || !config) {
      console.error('Error fetching payment config:', configError);
      return new Response(
        JSON.stringify({ error: '支付配置未找到或加载失败。请检查管理员后台配置。' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    console.log('Fetched Alipay config:', config);

    // 明确检查关键配置项
    if (!config.alipay_app_id || !config.alipay_private_key || !config.alipay_public_key || !config.notify_url || !config.app_public_key) {
      console.error('Missing critical Alipay config keys:', {
        private_key_exists: !!config.alipay_private_key,
        public_key_exists: !!config.alipay_public_key,
        app_public_key_exists: !!config.app_public_key,
        app_id_exists: !!config.alipay_app_id,
        notify_url_exists: !!config.notify_url
      });
      return new Response(
        JSON.stringify({ error: '支付宝配置不完整。请检查应用ID、应用私钥、支付宝公钥、应用公钥和通知URL是否已填写。' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 根据 is_sandbox 强制设置正确的网关地址
    let alipayGatewayUrl = config.alipay_gateway_url;
    if (config.is_sandbox) {
      alipayGatewayUrl = 'https://openapi.alipaydev.com/gateway.do';
      console.log('Sandbox mode is ON. Using sandbox gateway URL:', alipayGatewayUrl);
    } else {
      alipayGatewayUrl = 'https://openapi.alipay.com/gateway.do';
      console.log('Sandbox mode is OFF. Using production gateway URL:', alipayGatewayUrl);
    }

    const orderNumber = `ORD${Date.now()}${Math.floor(Math.random() * 1000)}`;
    console.log('Generated order number:', orderNumber);

    const { data: orderData, error: orderError } = await supabaseClient
      .from('orders')
      .insert({
        user_id: user.id,
        product_id: product_id,
        amount: total_amount,
        status: 'pending',
        payment_method: 'alipay',
        order_number: orderNumber,
        payment_id: null
      })
      .select()
      .single();

    if (orderError) {
      console.error('Supabase order insert error:', orderError);
      throw new Error(`Supabase订单插入失败: ${orderError.message}`);
    }
    console.log('Order created in Supabase:', orderData);

    // Manually construct and sign the Alipay request for alipay.trade.precreate
    const commonParams = {
      app_id: config.alipay_app_id,
      method: 'alipay.trade.precreate',
      format: 'JSON',
      charset: 'utf-8',
      sign_type: 'RSA2',
      timestamp: new Date().toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).replace(/\//g, '-'),
      version: '1.0',
      notify_url: config.notify_url,
    };

    const bizContent = {
      out_trade_no: orderNumber,
      total_amount: total_amount.toFixed(2),
      subject: subject,
      // seller_id: '2088xxxx', // Optional: If you have a specific seller ID
      // store_id: 'xxxx', // Optional: If you have a store ID
    };

    const allParams = { ...commonParams, biz_content: JSON.stringify(bizContent) };
    const signString = AlipayRSAUtils.buildSignString(allParams);
    
    const privateKey = await AlipayRSAUtils.importPrivateKey(config.alipay_private_key);
    const signature = await AlipayRSAUtils.signRSA2(signString, privateKey);

    const requestParams = new URLSearchParams();
    for (const key in allParams) {
      requestParams.append(key, allParams[key]);
    }
    requestParams.append('sign', signature);

    console.log('Sending request to Alipay gateway:', alipayGatewayUrl);
    const alipayResponse = await fetch(alipayGatewayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: requestParams.toString(),
    });

    const alipayResultText = await alipayResponse.text();
    console.log('Alipay raw response:', alipayResultText);

    let alipayResult;
    try {
      alipayResult = JSON.parse(alipayResultText);
    } catch (parseError) {
      console.error('Failed to parse Alipay response as JSON:', parseError);
      throw new Error(`支付宝响应解析失败: ${alipayResultText}`);
    }

    const precreateResponse = alipayResult.alipay_trade_precreate_response;
    const alipaySign = alipayResult.sign;

    if (!precreateResponse || precreateResponse.code !== '10000') {
      console.error('Alipay precreate failed:', precreateResponse);
      throw new Error(`支付宝业务错误: ${precreateResponse?.msg || precreateResponse?.sub_msg || '未知错误'}`);
    }

    // Verify Alipay's signature on its response (optional but recommended)
    const alipayPublicKey = await AlipayRSAUtils.importPublicKey(config.alipay_public_key);
    const isAlipaySignatureValid = await AlipayRSAUtils.verifyRSA2(JSON.stringify(precreateResponse), alipaySign, alipayPublicKey);
    
    if (!isAlipaySignatureValid) {
      console.warn('Alipay response signature verification failed!');
      // Depending on your security requirements, you might throw an error here.
      // For now, we'll log a warning and proceed.
    }

    await supabaseClient
      .from('orders')
      .update({ payment_id: precreateResponse.out_trade_no }) // Use outTradeNo from result, which should match orderNumber
      .eq('id', orderData.id);
    console.log('Order updated with payment_id:', precreateResponse.out_trade_no);

    return new Response(
      JSON.stringify({
        success: true,
        qr_code_url: precreateResponse.qr_code, // Alipay returns qr_code
        order_number: orderNumber,
        out_trade_no: precreateResponse.out_trade_no
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Caught error in create-alipay-order Edge Function:', error);
    let userErrorMessage = '创建订单失败';
    if (error instanceof Error) {
      userErrorMessage = error.message;
    }
    return new Response(
      JSON.stringify({
        success: false,
        error: userErrorMessage
      }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
})