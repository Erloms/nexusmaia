// @ts-ignore
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.9";
// @ts-ignore
import { crypto } from "https://deno.land/std@0.224.0/crypto/mod.ts";
// @ts-ignore
import { decode as base64decode } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper function to sort and concatenate parameters for verification
function getVerifyContent(params: URLSearchParams): string {
  const sortedKeys = Array.from(params.keys()).sort();
  let content = '';
  for (const key of sortedKeys) {
    const value = params.get(key);
    if (value !== null && key !== 'sign' && key !== 'sign_type') {
      content += `${key}=${value}&`;
    }
  }
  return content.slice(0, -1); // Remove trailing '&'
}

// TODO: REAL RSA VERIFICATION HERE
// This is a conceptual placeholder. You need to implement actual RSA2 (SHA256WithRSA) verification.
// This typically involves:
// 1. Converting alipay_public_key (PEM format) to a CryptoKey.
// 2. Hashing the content with SHA256.
// 3. Verifying the signature against the hash using the public key and 'RSASSA-PKCS1-v1_5' algorithm.
// You might need a Deno-compatible RSA library for this (e.g., from deno.land/x).
async function verifyWithRSA2(content: string, signature: string, publicKeyPem: string): Promise<boolean> {
  // This is a mock implementation. DO NOT USE IN PRODUCTION.
  console.warn("WARNING: Using mock RSA verification. Replace with real implementation in production!");
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const expectedHash = await crypto.subtle.digest("SHA-256", data);
  const decodedSignature = base64decode(signature);

  // In a real scenario, you'd compare expectedHash with the result of verifying decodedSignature
  // using the publicKeyPem. For this mock, we just check if the decoded signature has some length.
  return decodedSignature.byteLength > 0; 
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
    // Alipay notifications are typically application/x-www-form-urlencoded
    const requestBody = await req.text();
    // Use URLSearchParams for robust parsing of form-urlencoded data
    const params = new URLSearchParams(requestBody);

    const app_id = params.get('app_id');
    const out_trade_no = params.get('out_trade_no'); // Our internal order ID (payment_id in our orders table)
    const trade_status = params.get('trade_status');
    const sign = params.get('sign');
    const sign_type = params.get('sign_type');
    // ... other parameters from Alipay notification can be accessed via params.get('key')

    console.log('Alipay Notify Received:', Object.fromEntries(params.entries()));

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
    // TODO: REAL RSA VERIFICATION HERE
    // Replace this with a robust RSA2 verification implementation using alipayConfig.alipay_public_key
    // For production, you MUST use a secure cryptographic library.
    const verifyContent = getVerifyContent(params);
    const isSignatureValid = await verifyWithRSA2(verifyContent, sign || '', alipayConfig.alipay_public_key);
    const isAppIdValid = (app_id === alipayConfig.alipay_app_id); // Verify app_id

    console.log("Verify content:", verifyContent);
    console.log("Received signature:", sign);
    console.log("Is signature valid (mock):", isSignatureValid);
    console.log("Is App ID valid:", isAppIdValid);

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