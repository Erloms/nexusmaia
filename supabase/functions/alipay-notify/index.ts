// @ts-ignore
import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
// @ts-ignore
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.9'

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
      total_amount,
      trade_no,
      gmt_payment,
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

    // 验证签名
    const signParams = { ...notifyData };
    delete signParams.sign;
    delete signParams.sign_type;

    const signString = AlipayRSAUtils.buildSignString(signParams);
    console.log('验证签名字符串:', signString);

    let isSignatureValid = false;
    try {
      const publicKey = await AlipayRSAUtils.importPublicKey(config.alipay_public_key);
      isSignatureValid = await AlipayRSAUtils.verifyRSA2(signString, sign, publicKey);
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
          payment_id: trade_no,
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