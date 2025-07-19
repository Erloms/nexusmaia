/// <reference lib="deno.ns" />
// @ts-ignore
import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.9"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      // @ts-ignore
      Deno.env.get('SUPABASE_URL') ?? '',
      // @ts-ignore
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { prompt, size = "1024x1024", user_id } = await req.json()

    if (!prompt) {
      return new Response(
        JSON.stringify({ error: 'Prompt is required' }),
        { 
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    const ZHIPU_AI_API_KEY = Deno.env.get('ZHIPU_AI_API_KEY');
    if (!ZHIPU_AI_API_KEY) {
      throw new Error('ZHIPU_AI_API_KEY is not set in Supabase secrets.');
    }

    const response = await fetch('https://open.bigmodel.cn/api/paas/v4/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ZHIPU_AI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: "cogview-3-flash",
        prompt: prompt,
        size: size,
        user_id: user_id || 'anonymous_user' // Pass user_id if available
      })
    })

    const data = await response.json()

    if (!response.ok) {
      console.error('ZhipuAI API error:', data);
      throw new Error(data.error?.message || 'Image generation failed from ZhipuAI');
    }

    return new Response(
      JSON.stringify(data),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Image generation Edge Function error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})