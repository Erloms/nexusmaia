// @ts-ignore
import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
// @ts-ignore
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.9'
// @ts-ignore
import * as AlipaySdk from 'https://esm.sh/@alipay/easysdk@2.2.0'; // Import Alipay Easy SDK

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

    // **修正逻辑：根据 is_sandbox 强制设置正确的网关地址**
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

    // Configure Alipay Easy SDK
    AlipaySdk.config({
      appId: config.alipay_app_id,
      privateKey: `-----BEGIN PRIVATE KEY-----\n${config.alipay_private_key}\n-----END PRIVATE KEY-----`,
      alipayPublicKey: `-----BEGIN PUBLIC KEY-----\n${config.alipay_public_key}\n-----END PUBLIC KEY-----`,
      gateway: alipayGatewayUrl,
      // Optional:
      appCertPath: '', // Not needed for direct key usage
      alipayCertPath: '', // Not needed for direct key usage
      rootCertPath: '', // Not needed for direct key usage
      encryptKey: '', // Not used for this API
      signType: 'RSA2',
      // For cert mode, you would use:
      // appCertPath: '/path/to/your/appCert.crt',
      // alipayPublicCertPath: '/path/to/your/alipayCert.crt',
      // alipayRootCertPath: '/path/to/your/alipayRootCert.crt',
    });

    let alipayResult;
    try {
      // Use Easy SDK to precreate the order
      alipayResult = await AlipaySdk.Payment.FaceToFace().precreate(
        subject,
        orderNumber,
        total_amount.toFixed(2)
      );
      console.log('Alipay Easy SDK precreate result:', alipayResult);
    } catch (sdkError: any) {
      console.error('Alipay Easy SDK precreate failed:', sdkError);
      // SDK errors might be complex objects, try to extract a message
      const errorMessage = sdkError.message || sdkError.subMsg || sdkError.msg || JSON.stringify(sdkError);
      throw new Error(`支付宝SDK调用失败: ${errorMessage}. 请检查您的支付宝配置（如App ID、密钥、网关地址）是否正确。`);
    }

    if (alipayResult.code !== '10000') {
      console.error('Alipay returned an error code:', alipayResult.code, alipayResult.msg, alipayResult.subMsg);
      throw new Error(`支付宝业务错误: ${alipayResult.msg || alipayResult.subMsg}`);
    }

    await supabaseClient
      .from('orders')
      .update({ payment_id: alipayResult.outTradeNo }) // Use outTradeNo from result, which should match orderNumber
      .eq('id', orderData.id);
    console.log('Order updated with payment_id:', alipayResult.outTradeNo);

    return new Response(
      JSON.stringify({
        success: true,
        qr_code_url: alipayResult.qrCode, // Easy SDK returns qrCode
        order_number: orderNumber,
        out_trade_no: alipayResult.outTradeNo
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