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
    // 清理 PEM 格式，确保是 PKCS8 格式的纯 Base64 内容
    const pemHeader = "-----BEGIN PRIVATE KEY-----";
    const pemFooter = "-----END PRIVATE KEY-----";
    const pkcs8PemHeader = "-----BEGIN PKCS8 PRIVATE KEY-----";
    const pkcs8PemFooter = "-----END PKCS8 PRIVATE KEY-----";

    let cleanedKey = pemKey
      .replace(pemHeader, "")
      .replace(pemFooter, "")
      .replace(pkcs8PemHeader, "")
      .replace(pkcs8PemFooter, "")
      .replace(/\s/g, ""); // Remove all whitespace

    // 尝试 Base64 解码
    let binaryDer;
    try {
      binaryDer = Uint8Array.from(atob(cleanedKey), c => c.charCodeAt(0));
    } catch (e) {
      throw new Error(`Failed to base64 decode private key: ${e.message}`);
    }
    
    // 导入私钥
    return await crypto.subtle.importKey(
      "pkcs8", // 明确指定 PKCS8 格式
      binaryDer,
      {
        name: "RSASSA-PKCS1-v1_5",
        hash: "SHA-256",
      },
      true, // extractable: true for debugging, set to false in production
      ["sign"]
    );
  }

  // 将 PEM 格式的公钥转换为 CryptoKey
  static async importPublicKey(pemKey: string): Promise<CryptoKey> {
    // 清理 PEM 格式，确保是 SPKI 格式的纯 Base64 内容
    const pemHeader = "-----BEGIN PUBLIC KEY-----";
    const pemFooter = "-----END PUBLIC KEY-----";
    const spkiPemHeader = "-----BEGIN RSA PUBLIC KEY-----"; // Common for SPKI
    const spkiPemFooter = "-----END RSA PUBLIC KEY-----"; // Common for SPKI

    let cleanedKey = pemKey
      .replace(pemHeader, "")
      .replace(pemFooter, "")
      .replace(spkiPemHeader, "")
      .replace(spkiPemFooter, "")
      .replace(/\s/g, ""); // Remove all whitespace

    // 尝试 Base64 解码
    let binaryDer;
    try {
      binaryDer = Uint8Array.from(atob(cleanedKey), c => c.charCodeAt(0));
    } catch (e) {
      throw new Error(`Failed to base64 decode public key: ${e.message}`);
    }
    
    // 导入公钥
    return await crypto.subtle.importKey(
      "spki", // 明确指定 SPKI 格式
      binaryDer,
      {
        name: "RSASSA-PKCS1-v1_5",
        hash: "SHA-256",
      },
      true, // extractable: true for debugging, set to false in production
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
      .map(key => {
        // biz_content 需要特殊处理，其值本身是 JSON 字符串，不应再被 URL 编码
        if (key === 'biz_content') {
          return `${key}=${filteredParams[key]}`;
        }
        return `${key}=${encodeURIComponent(filteredParams[key])}`; // 对其他参数值进行 URL 编码
      })
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
      return new Response(
        JSON.stringify({ error: '缺少认证信息' }),
        { 
          status: 401, // Unauthorized
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    
    if (userError || !user) {
      console.error('User authentication failed:', userError);
      return new Response(
        JSON.stringify({ error: '用户认证失败' }),
        { 
          status: 401, // Unauthorized
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
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
      return new Response(
        JSON.stringify({ error: `Supabase订单插入失败: ${orderError.message}` }),
        { 
          status: 500, // Internal Server Error
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
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
      product_code: 'FACE_TO_FACE_PAYMENT', // This is correct for alipay.trade.precreate
    };

    const allParams = { ...commonParams, biz_content: JSON.stringify(bizContent) };
    const signString = AlipayRSAUtils.buildSignString(allParams);
    console.log('Signing string:', signString); // Log the string being signed
    
    let privateKey: CryptoKey;
    try {
      privateKey = await AlipayRSAUtils.importPrivateKey(config.alipay_private_key);
    } catch (e: any) {
      console.error('Error importing private key:', e);
      return new Response(
        JSON.stringify({ error: `私钥导入失败: ${e.message}. 请检查私钥格式是否正确 (PKCS8纯Base64)。` }),
        { 
          status: 500, // Internal Server Error
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    const signature = await AlipayRSAUtils.signRSA2(signString, privateKey);
    console.log('Generated signature:', signature); // Log the generated signature

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
      return new Response(
        JSON.stringify({ error: `支付宝响应解析失败: ${alipayResultText}` }),
        { 
          status: 500, // Internal Server Error
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    const precreateResponse = alipayResult.alipay_trade_precreate_response;
    const alipaySign = alipayResult.sign;

    if (!precreateResponse || precreateResponse.code !== '10000') {
      console.error('Alipay precreate failed:', precreateResponse);
      return new Response(
        JSON.stringify({ error: `支付宝业务错误: ${precreateResponse?.msg || precreateResponse?.sub_msg || '未知错误'}` }),
        { 
          status: 400, // Bad Request from Alipay, so our function returns 400
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Verify Alipay's signature on its response (optional but recommended)
    // Note: The response string to be verified should exclude the sign and sign_type fields.
    // It should be the JSON string of the response object itself.
    const responseToVerify = JSON.stringify(precreateResponse);
    let alipayPublicKey: CryptoKey;
    try {
      alipayPublicKey = await AlipayRSAUtils.importPublicKey(config.alipay_public_key);
    } catch (e: any) {
      console.warn('Error importing Alipay public key for verification:', e);
      // Do not throw, as this is for verification of Alipay's response, not our request.
    }
    
    // Only attempt verification if publicKey was successfully imported
    if (alipayPublicKey) {
      const isAlipaySignatureValid = await AlipayRSAUtils.verifyRSA2(responseToVerify, alipaySign, alipayPublicKey);
      if (!isAlipaySignatureValid) {
        console.warn('Alipay response signature verification failed!');
        // Depending on your security requirements, you might throw an error here.
        // For now, we'll log a warning and proceed.
      }
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
        status: 500, // Changed to 500 for internal server errors
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
})