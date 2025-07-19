// @ts-ignore
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.9";
// @ts-ignore
import { v4 as uuidv4 } from "https://deno.land/std@0.224.0/uuid/mod.ts";
// @ts-ignore
import { encode as base64encode } from "https://deno.land/std@0.224.0/encoding/base64.ts";
// @ts-ignore
import { crypto } from "https://deno.land/std@0.224.0/crypto/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper function to sort and concatenate parameters for signing
function getSignContent(params: Record<string, any>): string {
  const sortedKeys = Object.keys(params).sort();
  let content = '';
  for (const key of sortedKeys) {
    const value = params[key];
    if (value !== null && value !== undefined && key !== 'sign' && key !== 'sign_type') {
      content += `${key}=${value}&`;
    }
  }
  return content.slice(0, -1); // Remove trailing '&'
}

// TODO: REAL RSA SIGNING HERE
// This is a conceptual placeholder. You need to implement actual RSA2 (SHA256WithRSA) signing.
// This typically involves:
// 1. Converting alipay_private_key (PEM format) to a CryptoKey.
// 2. Hashing the content with SHA256.
// 3. Signing the hash with the private key using 'RSASSA-PKCS1-v1_5' algorithm.
// 4. Base64 encoding the signature.
// You might need a Deno-compatible RSA library for this (e.g., from deno.land/x).
async function signWithRSA2(content: string, privateKeyPem: string): Promise<string> {
  // This is a mock implementation. DO NOT USE IN PRODUCTION.
  // In a real scenario, you'd parse the PEM key, import it, and use crypto.subtle.sign.
  console.warn("WARNING: Using mock RSA signing. Replace with real implementation in production!");
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return base64encode(hash); // This is NOT a real RSA signature, just a base64 encoded hash.
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseClient = createClient(
    // @ts-ignore
    Deno.env.get('SUPABASE_URL') ?? '',
    // @ts-ignore
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', // Use service role key for database access
    {
      auth: {
        persistSession: false,
      },
    },
  );

  try {
    const { user_id, plan_id, amount, subject, return_url, notify_url } = await req.json();

    if (!user_id || !plan_id || !amount || !subject || !return_url || !notify_url) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameters: user_id, plan_id, amount, subject, return_url, notify_url' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 1. Fetch Alipay configuration from database
    const { data: alipayConfig, error: configError } = await supabaseClient
      .from('payment_configs')
      .select('*')
      .eq('id', 'alipay_config')
      .single();

    if (configError || !alipayConfig) {
      console.error('Failed to fetch Alipay config:', configError);
      throw new Error('Alipay configuration not found or error fetching it. Please configure it in Admin -> Alipay Config.');
    }

    // 2. Generate a unique internal order ID and Alipay's out_trade_no
    const orderId = uuidv4.generate();
    // Generate a unique order number for our system
    const { data: orderNumberData, error: orderNumberError } = await supabaseClient.rpc('generate_order_number');
    if (orderNumberError) {
      console.error('Error generating order number:', orderNumberError);
      throw new Error('Failed to generate unique order number.');
    }
    const orderNumber = orderNumberData;
    const outTradeNo = orderNumber; // Use our internal order number as Alipay's out_trade_no

    // Determine order_type based on plan_id (using the placeholder IDs from SQL)
    let orderType = 'unknown';
    if (plan_id === 'a0e1b2c3-d4e5-f6a7-b8c9-d0e1f2a3b4c5') {
      orderType = 'annual';
    } else if (plan_id === 'e1f2a3b4-c5d6-e7f8-a9b0-c1d2e3f4a5b6') {
      orderType = 'lifetime';
    } else if (plan_id === 'f5a6b7c8-d9e0-f1a2-b3c4-d5e6f7a8b9c0') {
      orderType = 'agent';
    }

    // 3. Insert a new order record into the 'orders' table (status: pending)
    const { data: orderData, error: orderError } = await supabaseClient
      .from('orders')
      .insert({
        id: orderId,
        user_id: user_id,
        plan_id: plan_id,
        amount: amount,
        status: 'pending',
        payment_method: 'alipay',
        payment_id: outTradeNo, // Use outTradeNo as payment_id for now
        order_type: orderType,
        subject: subject,
        order_number: orderNumber, // Save the generated order number
      })
      .select()
      .single();

    if (orderError) {
      console.error('Error inserting order:', orderError);
      throw new Error('Failed to create order in database.');
    }

    // --- Construct Alipay Request Parameters ---
    const alipayRequestParams: Record<string, any> = {
      app_id: alipayConfig.alipay_app_id,
      method: 'alipay.trade.precreate', // For QR code payment
      charset: 'utf-8',
      sign_type: 'RSA2',
      timestamp: new Date().toISOString().slice(0, 19).replace('T', ' '),
      version: '1.0',
      biz_content: JSON.stringify({
        out_trade_no: outTradeNo,
        total_amount: amount.toFixed(2), // Amount must be a string with 2 decimal places
        subject: subject,
        product_code: 'FACE_TO_FACE_PAYMENT', // For QR code payment
      }),
      notify_url: alipayConfig.notify_url, // Use configured notify_url
      return_url: alipayConfig.return_url, // Use configured return_url
    };

    // --- RSA SIGNING ---
    // TODO: REAL RSA SIGNING HERE
    // Replace this with a robust RSA2 signing implementation using alipayConfig.alipay_private_key
    // For production, you MUST use a secure cryptographic library.
    const signContent = getSignContent(alipayRequestParams);
    const signature = await signWithRSA2(signContent, alipayConfig.alipay_private_key);
    alipayRequestParams.sign = signature;

    // --- Send Request to Alipay (Simulated for now) ---
    // In a real scenario, you'd send alipayRequestParams to alipayConfig.alipay_gateway_url
    // using fetch and parse the real response.
    console.log("Simulating Alipay API call with params:", alipayRequestParams);
    console.log("Simulated sign content:", signContent);

    const realAlipayApiCallResult = {
      alipay_trade_precreate_response: {
        code: '10000',
        msg: 'Success',
        out_trade_no: outTradeNo,
        // This QR code URL is a placeholder. In production, it comes from Alipay's response.
        qr_code: `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=https://example.com/alipay_mock_payment?order_id=${orderId}&amount=${amount}&user_id=${user_id}&out_trade_no=${outTradeNo}`, 
      },
      sign: 'SIMULATED_ALIPAY_SIGNATURE', // This would be the actual signature from Alipay
    };

    if (realAlipayApiCallResult.alipay_trade_precreate_response.code !== '10000') {
      throw new Error(`Alipay API Error: ${realAlipayApiCallResult.alipay_trade_precreate_response.msg}`);
    }

    return new Response(
      JSON.stringify({
        order_id: orderId,
        out_trade_no: outTradeNo,
        qr_code_url: realAlipayApiCallResult.alipay_trade_precreate_response.qr_code,
        message: 'Payment order created successfully. Please scan the QR code to complete payment.',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Create Alipay Order Error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to create Alipay order' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});