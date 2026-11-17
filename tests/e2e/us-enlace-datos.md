# E2E — Enlace para completar el documento fuera del chat (071)

Automatizado en `scripts/e2e-enlace-datos.mjs` (`pnpm test:e2e:enlace-datos`).

**Por qué existe**: la política de WhatsApp Business prohíbe pedir números de
documento por el chat. El agente manda un enlace a una página del CRM.

**Preparación**: app en modo desarrollo con `AGENDA=on`, `WA_MOCK_ENABLED=true`,
`BOT_API_KEY`, la BD migrada, y `PW_CHROME` si Playwright no trae navegador.

1. El bot (`POST /api/bot/salud/enlace-datos`) pide un enlace: sin llave 401,
   conversación inexistente 404, sin `conversationId` 422, con todo 201 y una
   URL `/datos/<token>` que vence en 24 h. El token no queda en claro en la BD.
2. El paciente abre la página en un celular (390 px): saluda por su nombre,
   explica por qué se pide ahí, no se indexa y no desborda.
3. Un documento inválido muestra un error y NO quema el enlace.
4. Con datos válidos queda en la ficha (documento normalizado, nacimiento,
   afiliado), el contexto del bot ya lo ve y el panel del CRM lo muestra. La
   pantalla final trae «Volver a WhatsApp» con el mensaje ya escrito.
5. El enlace no sirve dos veces (página y API: 409); la ficha no se pisa.
6. Enlace inventado o con forma inválida: 404. Vencido: página «venció» y 409.
7. Cuatro envíos simultáneos: exactamente uno gana.
