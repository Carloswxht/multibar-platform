// =====================================================================
// MultiBar · Edge Function «recuperar-contrasena» (retirada el 24 oct)
// ---------------------------------------------------------------------
// Desde la web v36, recuperar la contraseña y la bienvenida van con Supabase
// Auth (resetPasswordForEmail) y el correo lo manda la Edge Function común
// «enviar-correo» (de AutonomIA-Lab). Esta función ya no manda nada: solo
// contesta 410 por si alguna web antigua la llama. No usa ninguna clave.
// El código antiguo está en archivo/servidor/recuperar-contrasena/index.ts.
// Desplegar con verify_jwt = false.
// =====================================================================

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-client-info',
};

Deno.serve((req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  return new Response(JSON.stringify({ codigo: 'YA_NO_SE_USA' }), {
    status: 410,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});
