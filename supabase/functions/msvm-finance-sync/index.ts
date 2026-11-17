// MSVM aggregate financial summary receiver.
// Deploy with JWT verification disabled; this endpoint authenticates using a separate high-entropy secret.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-msvm-sync-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const fields = [
  "cash_balance", "reserved_funds", "available_cash", "cleared_income",
  "cleared_expenses", "net_cash_movement", "pending_transaction_count",
  "overdue_bill_count", "total_debt", "savings_goal_remaining",
] as const;

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response({ error: "Method not allowed" }, 405);

  const expectedSecret = Deno.env.get("MSVM_SYNC_SECRET") ?? "";
  const suppliedSecret = req.headers.get("x-msvm-sync-secret") ?? "";
  const ownerId = Deno.env.get("MSVM_OWNER_USER_ID") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!expectedSecret || !ownerId || !supabaseUrl || !serviceKey) {
    return response({ error: "Server configuration incomplete" }, 500);
  }
  if (!constantTimeEqual(suppliedSecret, expectedSecret)) {
    return response({ error: "Unauthorized" }, 401);
  }

  let input: Record<string, unknown>;
  try {
    input = await req.json();
  } catch {
    return response({ error: "Invalid JSON" }, 400);
  }

  const record: Record<string, number> = {};
  for (const key of fields) {
    const value = input[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return response({ error: `Invalid or missing field: ${key}` }, 400);
    }
    if (key.endsWith("_count") && (!Number.isInteger(value) || value < 0)) {
      return response({ error: `Invalid count: ${key}` }, 400);
    }
    record[key] = value;
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await admin.from("msvm_finance_summary").upsert({
    user_id: ownerId,
    ...record,
    synced_at: new Date().toISOString(),
  }, { onConflict: "user_id" });

  if (error) {
    console.error("MSVM finance summary upsert failed:", error.message);
    return response({ error: "Could not store summary" }, 500);
  }
  return response({ ok: true, synced_at: new Date().toISOString() });
});
