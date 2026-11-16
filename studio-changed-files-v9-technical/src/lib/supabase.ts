import { createClient } from '@supabase/supabase-js';

// Ссылка из письма (установка/восстановление пароля) приходит с токеном в #hash. supabase-js разбирает и стирает hash
// при создании клиента, поэтому запоминаем, что это была ссылка восстановления, ДО createClient.
const initialHash = typeof window !== 'undefined' ? window.location.hash : '';
export const recoveryLink = {
  active: /[#&]type=recovery(&|$)/.test(initialHash) && /access_token=/.test(initialHash),
  failed: /[#&](error|error_code)=/.test(initialHash) && !/access_token=/.test(initialHash),
};

export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL ?? 'http://localhost', import.meta.env.VITE_SUPABASE_ANON_KEY ?? 'anon');
