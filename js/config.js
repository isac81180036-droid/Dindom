// Ligação com o Supabase. A chave "publishable" é pública por natureza: quem protege os dados
// são as permissões do banco (supabase/schema.sql). Nunca coloque aqui a chave secreta (sb_secret_…).
// Para usar o app só neste aparelho, sem servidor, deixe os dois campos vazios.
window.DINDOM_CONFIG = {
  supabaseUrl: 'https://lcohonwvajfiztrxbncm.supabase.co',
  supabaseKey: 'sb_publishable_PWqpZik3GbY34lgGZpBobw_rbgEyxsx'
};
