-- OAuth token bundle storage in Supabase Vault.
--
-- Security model:
--   * The raw OAuth token bundle ({access_token, refresh_token, expiry}) for a
--     calendar connection is NEVER stored in the oauth_connections row. It lives
--     encrypted-at-rest in Supabase Vault (pgsodium-backed vault.secrets), and
--     oauth_connections.vault_secret_id is only a UUID pointer into that vault.
--   * These two functions are the ONLY sanctioned path to read/write that bundle.
--     They are SECURITY DEFINER (run as the definer, which owns vault access) so
--     the token never has to be reachable by the caller's role directly.
--   * EXECUTE is granted to service_role ONLY, and explicitly revoked from anon
--     and authenticated. Combined with oauth_connections' SELECT-only RLS, this
--     means: end-user JWTs (anon/authenticated) can never read or write tokens;
--     only Edge Functions running with the service-role key can. The OAuth
--     callback, the refresh helper, and read_calendar_events all call these via
--     a service-role client.
--   * search_path is pinned so a hostile search_path can't shadow vault.* .
--
-- Token bundle JSON shape: { "access_token": string, "refresh_token": string,
-- "expiry": string (ISO 8601) }.

-- Store (create or update) the token bundle for a connection.
create or replace function public.oauth_token_set(
  p_connection_id uuid,
  p_token jsonb
) returns void
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_secret_id uuid;
begin
  select vault_secret_id into v_secret_id
  from public.oauth_connections
  where id = p_connection_id;

  if v_secret_id is null then
    -- New connection: create the vault secret, then point the row at it.
    v_secret_id := vault.create_secret(
      p_token::text,
      'oauth_token:' || p_connection_id::text,
      'OAuth token bundle for calendar connection ' || p_connection_id::text
    );
    update public.oauth_connections
      set vault_secret_id = v_secret_id
      where id = p_connection_id;
  else
    -- Existing connection: overwrite the stored secret in place.
    perform vault.update_secret(v_secret_id, p_token::text);
  end if;
end;
$$;

-- Read the decrypted token bundle for a connection, or null if none stored.
create or replace function public.oauth_token_get(
  p_connection_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_secret_id uuid;
  v_decrypted text;
begin
  select vault_secret_id into v_secret_id
  from public.oauth_connections
  where id = p_connection_id;

  if v_secret_id is null then
    return null;
  end if;

  select decrypted_secret into v_decrypted
  from vault.decrypted_secrets
  where id = v_secret_id;

  if v_decrypted is null then
    return null;
  end if;

  return v_decrypted::jsonb;
end;
$$;

-- Lock down execution: service_role only. Edge Functions using the service-role
-- key are the sole callers; end-user roles must never touch tokens.
revoke all on function public.oauth_token_set(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.oauth_token_get(uuid) from public, anon, authenticated;
grant execute on function public.oauth_token_set(uuid, jsonb) to service_role;
grant execute on function public.oauth_token_get(uuid) to service_role;
