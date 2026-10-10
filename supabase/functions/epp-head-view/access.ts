export function requireHeadViewer(account: any, action: string) {
  if (!account?.active || account.role !== 'trainer' || account.is_admin !== true || account.is_platform_admin !== true || account.must_change_password) throw new Error('geen_hoofdbeheerrechten');
  if (!['catalog','view'].includes(action)) throw new Error('alleen_lezen');
}
