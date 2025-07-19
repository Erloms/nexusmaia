// @ts-ignore
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.9";
// @ts-ignore
import { v4 as uuidv4 } from "https://deno.land/std@0.224.0/uuid/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    // --- IMPORTANT: REAL ALIPAY API CALL AND RSA2 SIGNING GOES HERE ---
    // This is the most complex part. You need to:
    // 1. Construct the request parameters for Alipay's API (e.g., alipay.trade.precreate for QR code).
    //    Parameters include: app_id, method, charset, sign_type, timestamp, version, biz_content, notify_url, return_url.
    // 2. The `biz_content` should be a JSON string containing: out_trade_no, total_amount, subject, product_code (e.g., 'FACE_TO_FACE_PAYMENT').
    // 3. **Sign** these parameters using your `alipayConfig.alipay_private_key` with RSA2 (SHA256WithRSA) algorithm.
    //    This typically involves:
    //    a. Sorting all request parameters (excluding 'sign' and 'sign_type') alphabetically.
    //    b. Concatenating them into a string like "key1=value1&key2=value2...".
    //    c. Hashing this string with SHA256.
    //    d. Signing the hash with your RSA private key.
    //    e. Base64 encoding the signature.
    //    You will likely need a Deno-compatible RSA signing library for this.
    // 4. Send the signed request to `alipayConfig.alipay_gateway_url`.
    // 5. Parse Alipay's response to get the actual QR code URL or redirect form data.

    // Placeholder for Alipay request parameters
    const alipayRequestParams = {
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
      notify_url: notify_url,
      return_url: return_url,
      // 'sign' field will be added after signing
    };

    // --- RSA SIGNING PLACEHOLDER ---
    // In a real production environment, you would use a library to perform RSA2 signing here.
    // Example (conceptual):
    // const signContent = Object.keys(alipayRequestParams)
    //   .sort()
    //   .filter(key => key !== 'sign' && key !== 'sign_type')
    //   .map(key => `${key}=${alipayRequestParams[key]}`)
    //   .join('&');
    // const signature = await signWithRSA2(signContent, alipayConfig.alipay_private_key);
    // alipayRequestParams.sign = signature;
    // --- END RSA SIGNING PLACEHOLDER ---

    // Simulate the actual Alipay API call and response for now
    // In a real scenario, you'd use `fetch` to send `alipayRequestParams` to `alipayConfig.alipay_gateway_url`
    // and handle the real response.
    const realAlipayApiCallResult = {
      alipay_trade_precreate_response: {
        code: '10000',
        msg: 'Success',
        out_trade_no: outTradeNo,
        qr_code: `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=https://example.com/alipay_mock_payment?order_id=${orderId}&amount=${amount}&user_id=${user_id}&out_trade_no=${outTradeNo}`, // This would be the actual QR code from Alipay
      },
      sign: 'SIMULATED_SIGNATURE', // This would be the actual signature from Alipay
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