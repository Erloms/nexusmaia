/// <reference lib="deno.ns" />
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { AlipayRSAUtils } from '../_shared/crypto-utils.ts'

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
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { subject, total_amount, product_id } = await req.json() as CreateOrderRequest;

    console.log('创建支付宝订单请求:', { subject, total_amount, product_id });

    // 获取当前用户
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('缺少认证信息');
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    
    if (userError || !user) {
      throw new Error('用户认证失败');
    }

    // 获取支付宝配置
    const { data: config, error: configError } = await supabaseClient
      .from('payment_configs')
      .select('*')
      .eq('id', 'alipay_config')
      .single();

    if (configError || !config) {
      console.error('获取支付配置失败:', configError);
      throw new Error('支付配置未找到');
    }

    // 生成订单号
    const orderNumber = `ORD${Date.now()}${Math.floor(Math.random() * 1000)}`;

    // 创建订单记录
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
      console.error('创建订单失败:', orderError);
      throw new Error('创建订单失败');
    }

    console.log('订单创建成功:', orderData);

    // 构建支付宝请求参数
    const alipayParams = {
      app_id: config.alipay_app_id,
      method: 'alipay.trade.precreate',
      charset: 'utf-8',
      sign_type: 'RSA2',
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
      version: '1.0',
      out_trade_no: orderNumber,
      total_amount: total_amount.toFixed(2),
      subject: subject,
      notify_url: config.notify_url,
    };

    console.log('支付宝请求参数:', alipayParams);

    // 生成签名字符串
    const signString = AlipayRSAUtils.buildSignString(alipayParams);
    console.log('待签名字符串:', signString);

    // 导入私钥并签名
    let signature: string;
    try {
      const privateKey = await AlipayRSAUtils.importPrivateKey(config.alipay_private_key);
      signature = await AlipayRSAUtils.signRSA2(signString, privateKey);
      console.log('生成签名成功');
    } catch (error) {
      console.error('签名生成失败:', error);
      throw new Error('签名生成失败');
    }

    // 添加签名到参数
    const finalParams = {
      ...alipayParams,
      sign: signature
    };

    // 发送请求到支付宝
    const alipayUrl = config.alipay_gateway_url;
    const formData = new URLSearchParams();
    
    Object.keys(finalParams).forEach(key => {
      formData.append(key, finalParams[key as keyof typeof finalParams]);
    });

    console.log('发送请求到支付宝:', alipayUrl);

    const alipayResponse = await fetch(alipayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString()
    });

    if (!alipayResponse.ok) {
      throw new Error(`支付宝API请求失败: ${alipayResponse.status}`);
    }

    const responseText = await alipayResponse.text();
    console.log('支付宝响应:', responseText);

    // 解析支付宝响应
    let alipayResult;
    try {
      const responseJson = JSON.parse(responseText);
      alipayResult = responseJson.alipay_trade_precreate_response;
    } catch (error) {
      console.error('解析支付宝响应失败:', error);
      throw new Error('解析支付宝响应失败');
    }

    if (alipayResult.code !== '10000') {
      console.error('支付宝返回错误:', alipayResult);
      throw new Error(`支付宝错误: ${alipayResult.msg || alipayResult.sub_msg}`);
    }

    // 更新订单的支付ID
    await supabaseClient
      .from('orders')
      .update({ payment_id: alipayResult.out_trade_no })
      .eq('id', orderData.id);

    // 返回二维码链接
    return new Response(
      JSON.stringify({
        success: true,
        qr_code_url: alipayResult.qr_code,
        order_number: orderNumber,
        out_trade_no: alipayResult.out_trade_no
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('创建支付宝订单失败:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : '创建订单失败' 
      }),
      { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
})