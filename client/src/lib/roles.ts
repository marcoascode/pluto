import type { Role } from '@/types/api';

export const ROLE_LABEL: Record<Role, string> = { gestor: 'Gestor', gerente: 'Gerente', admin: 'Admin', superadmin: 'SuperAdmin' };
export const ROLE_HELP: Record<Role, string> = {
  gestor: 'Vê os domínios que gere e, em cada um, só as campanhas das contas Google/Meta ligadas a ele.',
  gerente: 'Vê os relatórios de vários Squads (os escolhidos aqui e os das Empresas em que é sócio). Sem acesso à administração.',
  admin: 'Vê e edita tudo (usuários, domínios, contas), menos conectar integrações e mudar a frequência do sync.',
  superadmin: 'Acesso a todas as funções, inclusive conectar integrações e mudar a frequência de sincronização.',
};
export const roleTone = (r: Role) => (r === 'superadmin' ? 'pos' : r === 'admin' ? 'accent' : r === 'gerente' ? 'warn' : 'na') as 'pos' | 'accent' | 'warn' | 'na';
