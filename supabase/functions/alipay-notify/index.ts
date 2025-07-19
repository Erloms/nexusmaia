// @ts-ignore
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.9";
// @ts-ignore
import { parse } from "https://deno.land/std@0.168.0/node/querystring.ts"; // For parsing x-www-form-urlencoded

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
    // Alipay notifications are typically application/x-www-form-urlencoded
    const requestBody = await req.text();
    const params = parse(requestBody);

    const {
      app_id,
      out_trade_no, // Our internal order ID (payment_id in our orders table)
      trade_status,
      sign,
      sign_type,
      // ... other parameters from Alipay notification
    } = params;

    console.log('Alipay Notify Received:', params);

    // 1. Fetch Alipay configuration (especially public key for verification)
    const { data: alipayConfig, error: configError } = await supabaseClient
      .from('payment_configs')
      .select('alipay_public_key, alipay_app_id')
      .eq('id', 'alipay_config')
      .single();

    if (configError || !alipayConfig) {
      console.error('Failed to fetch Alipay config for notify:', configError);
      return new Response('fail', { status: 500 }); // Return 'fail' to Alipay
    }

    // --- IMPORTANT: REAL ALIPAY SIGNATURE VERIFICATION GOES HERE ---
    // In a real production environment, you MUST implement robust signature verification.
    // This involves:
    // 1. Reconstructing the string to be signed from the received parameters.
    //    Exclude 'sign' and 'sign_type' from the parameters used for signing.
    //    Parameters should be sorted alphabetically and concatenated in 'key=value&' format.
    // 2. Using Alipay's public key (alipayConfig.alipay_public_key) to verify the 'sign' parameter
    //    against the reconstructed string. The algorithm should be RSA2 (SHA256WithRSA).
    //    You will likely need a Deno-compatible RSA verification library for this.
    // 3. Also verify `app_id` from the notification matches your configured `alipayConfig.alipay_app_id`.
    // 4. Check `seller_id` if applicable.
    // If verification fails, return 'fail'.

    // Example of how you might prepare parameters for verification (simplified)
    // const paramsToVerify = { ...params };
    // delete paramsToVerify.sign;
    // delete paramsToVerify.sign_type;
    // const sortedKeys = Object.keys(paramsToVerify).sort();
    // const verifyContent = sortedKeys.map(key => `${key}=${paramsToVerify[key]}`).join('&');
    // const isSignatureValid = await yourRsaVerificationFunction(verifyContent, sign, alipayConfig.alipay_public_key, sign_type);

    const isSignatureValid = true; // Placeholder: Replace with actual verification logic
    const isAppIdValid = (app_id === alipayConfig.alipay_app_id); // Verify app_id

    if (!isSignatureValid || !isAppIdValid) {
      console.error('Alipay notification: Signature or App ID verification failed.');
      return new Response('fail', { status: 400 }); // Return 'fail' to Alipay
    }
    // --- END OF REAL ALIPAY SIGNATURE VERIFICATION SECTION ---

    if (trade_status === 'TRADE_SUCCESS') {
      // Payment was successful
      console.log(`Alipay payment successful for out_trade_no: ${out_trade_no}`);

      // Find the corresponding order in our database using payment_id (which is out_trade_no)
      const { data: order, error: orderError } = await supabaseClient
        .from('orders')
        .select('*')
        .eq('payment_id', out_trade_no)
        .single();

      if (orderError || !order) {
        console.error(`Order not found or error fetching order for payment_id: ${out_trade_no}`, orderError);
        return new Response('fail', { status: 500 }); // Order not found in our system
      }

      // Check if the order is already processed to prevent duplicate processing
      if (order.status === 'completed') {
        console.log(`Order ${order.id} already completed. Skipping.`);
        return new Response('success', { status: 200 }); // Already processed, return 'success' to Alipay
      }

      // Update order status to 'completed'
      const { error: updateError } = await supabaseClient
        .from('orders')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('id', order.id);

      if (updateError) {
        console.error(`Failed to update order status for ${order.id}:`, updateError);
        return new Response('fail', { status: 500 }); // Database update failed
      }

      // Activate user membership using the RPC function
      const { error: activateError } = await supabaseClient.rpc('activate_membership', {
        p_user_id: order.user_id!, // user_id is UUID, should not be null here
        p_plan_id: order.plan_id!, // plan_id is UUID, should not be null here
        p_order_id: order.id // Pass the order ID
      });

      if (activateError) {
        console.error(`Failed to activate membership for user ${order.user_id} with plan ${order.plan_id}:`, activateError);
        // Depending on your business logic, you might want to revert order status or log for manual review
        return new Response('fail', { status: 500 }); // Membership activation failed
      }

      console.log(`Membership activated for user ${order.user_id} via order ${order.id}`);
      return new Response('success', { status: 200 }); // Crucial: Return 'success' to Alipay
    } else if (trade_status === 'TRADE_CLOSED' || trade_status === 'TRADE_FINISHED') {
      // Handle other statuses if necessary, e.g., update order to 'closed' or 'failed'
      console.log(`Alipay trade status: ${trade_status} for out_trade_no: ${out_trade_no}`);
      // You might want to update the order status in your DB to 'closed' or 'finished'
      return new Response('success', { status: 200 });
    } else {
      console.warn(`Unhandled Alipay trade status: ${trade_status} for out_trade_no: ${out_trade_no}`);
      return new Response('success', { status: 200 }); // Acknowledge receipt even for unhandled statuses
    }

  } catch (error) {
    console.error('Alipay Notify Edge Function Error:', error);
    return new Response('fail', { status: 500 }); // Return 'fail' on any unexpected error
  }
});