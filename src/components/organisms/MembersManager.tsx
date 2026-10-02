'use client';

/** Gestión de miembros: roles, expulsión, invitaciones (enlace de un solo uso) y su revocación. */
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import {
  changeMemberRoleAction,
  inviteMemberAction,
  removeMemberAction,
  revokeInvitationAction,
} from '@/app/_server/actions/settings.actions';
import { useAction } from '@/common/hooks/use-action';
import { StatusChip } from '@/components/atoms/StatusChip';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { CopyField } from '@/components/molecules/CopyField';
import { MEMBERSHIP_ROLES, roleRank, type MembershipRole } from '@/core/identity/roles';

interface Member {
  id: string;
  userId: string;
  email: string;
  name: string | null;
  role: MembershipRole;
}

interface Invitation {
  id: string;
  email: string;
  role: MembershipRole;
  expiresAt: Date;
}

interface MembersManagerProps {
  tenantSlug: string;
  members: Member[];
  invitations: Invitation[];
  currentUserId: string;
  actorRole: MembershipRole;
  canManage: boolean;
}

function assignableRoles(actorRole: MembershipRole): MembershipRole[] {
  return MEMBERSHIP_ROLES.filter((role) =>
    role === 'OWNER' ? actorRole === 'OWNER' : roleRank(actorRole) >= roleRank(role),
  );
}

export function MembersManager({
  tenantSlug,
  members,
  invitations,
  currentUserId,
  actorRole,
  canManage,
}: MembersManagerProps) {
  const t = useTranslations();
  const locale = useLocale();
  const { run, pending, fieldErrors } = useAction();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);
  const roles = assignableRoles(actorRole);
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });

  const canManageMember = (member: Member) =>
    canManage && (member.role !== 'OWNER' || actorRole === 'OWNER');

  const invite = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(
      () =>
        inviteMemberAction(tenantSlug, {
          email: String(form.get('email') ?? ''),
          role: String(form.get('role') ?? 'VIEWER'),
        }),
      {
        onSuccess: (data) =>
          setInviteLink(`${window.location.origin}/${locale}/invite/${data.token}`),
      },
    );
  };

  const closeInvite = () => {
    setInviteOpen(false);
    setInviteLink(null);
  };

  return (
    <div className="flex flex-col gap-8">
      <Alert severity="info">{t('Settings.rolesHelp')}</Alert>
      {canManage ? (
        <div className="flex justify-end">
          <Button variant="contained" onClick={() => setInviteOpen(true)}>
            {t('Settings.invite')}
          </Button>
        </div>
      ) : null}

      <TableContainer className="rounded-lg border border-line">
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>{t('Common.name')}</TableCell>
              <TableCell className="w-56">{t('Settings.role')}</TableCell>
              <TableCell align="right">{t('Common.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {members.map((member) => (
              <TableRow key={member.id}>
                <TableCell>
                  <Typography variant="body2" className="font-semibold">
                    {member.name ?? member.email}{' '}
                    {member.userId === currentUserId ? t('Settings.you') : null}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {member.email}
                  </Typography>
                </TableCell>
                <TableCell>
                  {canManageMember(member) ? (
                    <FormControl size="small" fullWidth>
                      <Select
                        aria-label={`${t('Settings.role')}: ${member.email}`}
                        value={member.role}
                        onChange={(event) =>
                          void run(
                            () =>
                              changeMemberRoleAction(tenantSlug, {
                                membershipId: member.id,
                                role: event.target.value,
                              }),
                            {
                              successMessage: t('Common.saved'),
                            },
                          )
                        }
                        disabled={pending}
                      >
                        {[...new Set([...roles, member.role])].map((role) => (
                          <MenuItem key={role} value={role} disabled={!roles.includes(role)}>
                            {t(`Roles.${role}`)}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  ) : (
                    <StatusChip label={t(`Roles.${member.role}`)} tone="primary" />
                  )}
                </TableCell>
                <TableCell align="right">
                  {canManageMember(member) ? (
                    <Button color="error" size="small" onClick={() => setRemoving(member)}>
                      {t('Common.remove')}
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {invitations.length > 0 ? (
        <section className="flex flex-col gap-3">
          <Typography variant="h6" component="h2">
            {t('Settings.pendingInvitations')}
          </Typography>
          <TableContainer className="rounded-lg border border-line">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('Auth.email')}</TableCell>
                  <TableCell>{t('Settings.role')}</TableCell>
                  <TableCell>{t('Settings.expires')}</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {invitations.map((invitation) => (
                  <TableRow key={invitation.id}>
                    <TableCell>{invitation.email}</TableCell>
                    <TableCell>{t(`Roles.${invitation.role}`)}</TableCell>
                    <TableCell>{dateFormat.format(new Date(invitation.expiresAt))}</TableCell>
                    <TableCell align="right">
                      {canManage ? (
                        <Button
                          size="small"
                          color="error"
                          disabled={pending}
                          onClick={() =>
                            void run(
                              () => revokeInvitationAction(tenantSlug, { id: invitation.id }),
                              {
                                successMessage: t('Common.saved'),
                              },
                            )
                          }
                        >
                          {t('Settings.revoke')}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </section>
      ) : null}

      <Dialog open={inviteOpen} onClose={closeInvite} fullWidth maxWidth="sm">
        {inviteLink ? (
          <>
            <DialogTitle>{t('Settings.inviteLinkTitle')}</DialogTitle>
            <DialogContent className="flex flex-col gap-4">
              <Alert severity="warning">{t('Settings.inviteLinkBody')}</Alert>
              <CopyField label={t('Settings.inviteLinkTitle')} value={inviteLink} />
            </DialogContent>
            <DialogActions>
              <Button onClick={closeInvite}>{t('Common.close')}</Button>
            </DialogActions>
          </>
        ) : (
          <form onSubmit={invite} noValidate>
            <DialogTitle>{t('Settings.inviteTitle')}</DialogTitle>
            <DialogContent className="flex flex-col gap-4 pt-2">
              <TextField
                name="email"
                type="email"
                label={t('Auth.email')}
                required
                autoFocus
                fullWidth
                margin="dense"
                error={Boolean(fieldErrors.email)}
              />
              <FormControl fullWidth>
                <InputLabel id="invite-role">{t('Settings.role')}</InputLabel>
                <Select
                  labelId="invite-role"
                  name="role"
                  label={t('Settings.role')}
                  defaultValue="EDITOR"
                >
                  {roles.map((role) => (
                    <MenuItem key={role} value={role}>
                      {t(`Roles.${role}`)}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </DialogContent>
            <DialogActions>
              <Button onClick={closeInvite}>{t('Common.cancel')}</Button>
              <Button type="submit" variant="contained" disabled={pending}>
                {t('Settings.invite')}
              </Button>
            </DialogActions>
          </form>
        )}
      </Dialog>

      <ConfirmDialog
        open={removing !== null}
        title={t('Settings.removeMemberTitle')}
        body={t('Settings.removeMemberBody')}
        confirmLabel={t('Common.remove')}
        pending={pending}
        onClose={() => setRemoving(null)}
        onConfirm={() =>
          removing &&
          void run(() => removeMemberAction(tenantSlug, { id: removing.id }), {
            successMessage: t('Common.saved'),
            onSuccess: () => setRemoving(null),
          })
        }
      />
    </div>
  );
}
