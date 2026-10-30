/** Remove o serviço do Windows "GestaoXmlAgent". Uso: node scripts\uninstall-service.cjs (como Administrador) */
const path = require('node:path');
const { Service } = require('node-windows');

const svc = new Service({ name: 'GestaoXmlAgent', script: path.resolve(__dirname, '..', 'dist', 'agent.cjs') });
svc.on('uninstall', () => console.log('Serviço removido.'));
svc.on('error', (e) => console.error('Erro:', e));
svc.uninstall();
