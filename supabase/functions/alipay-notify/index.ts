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

serve(async (req) => {
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

    // 处理支付宝异步通知（表单数据）
    const formData = await req.formData();
    const notifyData: Record<string, string> = {};
    
    for (const [key, value] of formData.entries()) {
      notifyData[key] = value.toString();
    }

    console.log('支付宝异步通知数据:', notifyData);

    const {
      out_trade_no,
      trade_status,
      sign,
      sign_type
    } = notifyData;

    if (!out_trade_no || !trade_status || !sign) {
      throw new Error('缺少必要参数');
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

    // Configure Alipay Easy SDK for verification
    AlipaySdk.config({
      appId: config.alipay_app_id, // App ID is needed for some internal checks by SDK
      privateKey: `-----BEGIN PRIVATE KEY-----\n${config.alipay_private_key}\n-----END PRIVATE KEY-----`, // Private key is not strictly needed for verifyNotify, but good to have consistent config
      alipayPublicKey: `-----BEGIN PUBLIC KEY-----\n${config.alipay_public_key}\n-----END PUBLIC KEY-----`,
      gateway: config.alipay_gateway_url,
      // For cert mode, you would use:
      // appCertPath: '/path/to/your/appCert.crt',
      // alipayPublicCertPath: '/path/to/your/alipayCert.crt',
      // alipayRootCertPath: '/path/to/your/alipayRootCert.crt',
    });

    let isSignatureValid = false;
    try {
      // Use Easy SDK to verify the notification signature
      isSignatureValid = AlipaySdk.Payment.Common().verifyNotify(notifyData);
      console.log('签名验证结果:', isSignatureValid);
    } catch (error) {
      console.error('签名验证失败:', error);
      throw new Error('签名验证失败');
    }

    if (!isSignatureValid) {
      throw new Error('签名验证不通过');
    }

    // 查找订单
    const { data: orderData, error: orderError } = await supabaseClient
      .from('orders')
      .select('*, membership_plans(*)')
      .eq('order_number', out_trade_no)
      .single();

    if (orderError || !orderData) {
      console.error('订单未找到:', orderError);
      throw new Error('订单不存在');
    }

    console.log('找到订单:', orderData);

    // 处理支付状态
    if (trade_status === 'TRADE_SUCCESS' || trade_status === 'TRADE_FINISHED') {
      // 支付成功，更新订单状态
      const { error: updateError } = await supabaseClient
        .from('orders')
        .update({
          status: 'paid',
          payment_id: notifyData.trade_no, // Use trade_no from notify data
          updated_at: new Date().toISOString()
        })
        .eq('id', orderData.id);

      if (updateError) {
        console.error('更新订单状态失败:', updateError);
        throw updateError;
      }

      // 激活会员权限
      if (orderData.product_id) {
        try {
          const { error: activateError } = await supabaseClient
            .rpc('activate_membership', {
              p_user_id: orderData.user_id,
              p_plan_id: orderData.product_id,
              p_order_id: orderData.id
            });

          if (activateError) {
            console.error('激活会员失败:', activateError);
          } else {
            console.log('会员权限激活成功');
          }
        } catch (error) {
          console.error('调用激活函数失败:', error);
        }
      }

      console.log('支付处理完成');
    } else {
      console.log('支付状态:', trade_status);
    }

    // 返回success给支付宝
    return new Response('success', {
      headers: { ...corsHeaders, 'Content-Type': 'text/plain' }
    });

  } catch (error) {
    console.error('处理支付宝通知失败:', error);
    return new Response('fail', {
      headers: { ...corsHeaders, 'Content-Type': 'text/plain' }
    });
  }
})