'use client';

/**
 * Identidad visual de los correos: logotipo, color principal (enlaces y cabecera), color de los
 * botones y texto del pie. El contraste WCAG AA se calcula en vivo y se valida al guardar.
 */
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { removeLogoAction, updateBrandingAction } from '@/app/_server/actions/branding.actions';
import { useNotify } from '@/common/hooks/notifications';
import { useAction } from '@/common/hooks/use-action';
import { useRouter } from '@/common/i18n/navigation';
import { ColorSwatch } from '@/components/atoms/ColorSwatch';
import { StatusChip } from '@/components/atoms/StatusChip';
import { FileDropzone } from '@/components/molecules/FileDropzone';
import { brandingContrast, buttonTextColor } from '@/core/tenants/branding';

const HEX = /^#[0-9a-fA-F]{6}$/;

interface BrandingFormProps {
  tenantSlug: string;
  branding: { primary: string; accent: string; footerMd: string | null };
  logoUrl: string | null;
  postalAddressMissing: boolean;
  canWrite: boolean;
}

function ColorField({
  id,
  label,
  hint,
  value,
  onChange,
  error,
  disabled,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  error: string | null;
  disabled: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <input
        type="color"
        aria-labelledby={`${id}-label`}
        value={HEX.test(value) ? value : '#000000'}
        onChange={(event) => onChange(event.target.value.toUpperCase())}
        disabled={disabled}
        className="mt-2 h-10 w-12 cursor-pointer rounded border border-line bg-transparent p-0"
      />
      <TextField
        id={id}
        label={<span id={`${id}-label`}>{label}</span>}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        error={error !== null}
        helperText={error ?? hint}
        className="flex-1"
        slotProps={{ htmlInput: { maxLength: 7, spellCheck: false } }}
      />
    </div>
  );
}

export function BrandingForm({
  tenantSlug,
  branding,
  logoUrl,
  postalAddressMissing,
  canWrite,
}: BrandingFormProps) {
  const t = useTranslations();
  const router = useRouter();
  const notify = useNotify();
  const { run, pending, fieldErrors } = useAction();
  const [primary, setPrimary] = useState(branding.primary);
  const [accent, setAccent] = useState(branding.accent);
  const [footerMd, setFooterMd] = useState(branding.footerMd ?? '');
  const [uploading, setUploading] = useState(false);
  const valid = HEX.test(primary) && HEX.test(accent);
  const contrast = valid ? brandingContrast({ primary, accent }) : null;
  const disabled = !canWrite;

  const lowContrast = (field: 'primary' | 'accent') =>
    fieldErrors[field]?.includes('LOW_CONTRAST') ? t('Branding.lowContrast') : null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run(() => updateBrandingAction(tenantSlug, { primary, accent, footerMd }), {
      successMessage: t('Common.saved'),
    });
  };

  const uploadLogo = async (file: File) => {
    setUploading(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const response = await fetch(`/api/t/${tenantSlug}/branding/logo`, { method: 'POST', body });
      if (response.ok) {
        notify(t('Branding.logoUploaded'), 'success');
        router.refresh();
        return;
      }
      const payload = (await response.json().catch(() => ({}))) as {
        error?: { code?: string; details?: { reason?: string } };
      };
      const reason = payload.error?.details?.reason;
      notify(
        reason === 'FILE_SIZE' || reason === 'FILE_TYPE'
          ? t(`Branding.logoErrors.${reason}`)
          : t('Errors.UNEXPECTED', { traceId: '-' }),
        'error',
      );
    } finally {
      setUploading(false);
    }
  };

  const ratio = (value: number) => `${value.toFixed(1)}:1`;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Paper variant="outlined" component="section" className="flex flex-col gap-4 p-4">
        <Typography variant="h6" component="h2">
          {t('Branding.logo')}
        </Typography>
        {logoUrl ? (
          <div className="flex flex-col items-start gap-3">
            <div className="rounded-lg border border-line bg-white p-4">
              <Image
                src={logoUrl}
                alt={t('Branding.currentLogo')}
                width={240}
                height={80}
                unoptimized
                className="h-12 w-auto"
              />
            </div>
            {canWrite ? (
              <Button
                color="error"
                disabled={pending}
                onClick={() =>
                  void run(() => removeLogoAction(tenantSlug, {}), {
                    successMessage: t('Branding.logoRemoved'),
                  })
                }
              >
                {t('Branding.removeLogo')}
              </Button>
            ) : null}
          </div>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {t('Branding.noLogo')}
          </Typography>
        )}
        {canWrite ? (
          <FileDropzone
            compact
            accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
            label={t('Branding.logoDropzone')}
            hint={t('Branding.logoHint')}
            busyLabel={t('Documents.uploading')}
            busy={uploading}
            onFile={uploadLogo}
          />
        ) : null}
      </Paper>

      <Paper variant="outlined" component="section" className="flex flex-col gap-4 p-4">
        <Typography variant="h6" component="h2">
          {t('Branding.colors')}
        </Typography>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <ColorField
            id="branding-primary"
            label={t('Branding.primary')}
            hint={t('Branding.primaryHint')}
            value={primary}
            onChange={setPrimary}
            error={lowContrast('primary')}
            disabled={disabled}
          />
          <ColorField
            id="branding-accent"
            label={t('Branding.accent')}
            hint={t('Branding.accentHint')}
            value={accent}
            onChange={setAccent}
            error={lowContrast('accent')}
            disabled={disabled}
          />
          {contrast ? (
            <div className="flex flex-col gap-3 rounded-lg border border-line p-3">
              <Typography variant="subtitle2" component="p">
                {t('Branding.contrastTitle')}
              </Typography>
              <div className="flex items-center gap-3">
                <ColorSwatch color="#FFFFFF" text="Aa" textColor={primary} width={56} />
                <Typography variant="body2" className="flex-1">
                  {t('Branding.linkContrast', { ratio: ratio(contrast.primary) })}
                </Typography>
                <StatusChip
                  label={contrast.primaryOk ? t('Branding.passes') : t('Branding.fails')}
                  tone={contrast.primaryOk ? 'success' : 'error'}
                />
              </div>
              <div className="flex items-center gap-3">
                <ColorSwatch
                  color={accent}
                  text={t('Branding.buttonSample')}
                  textColor={buttonTextColor(accent)}
                  width={96}
                />
                <Typography variant="body2" className="flex-1">
                  {t('Branding.buttonContrast', { ratio: ratio(contrast.button) })}
                </Typography>
                <StatusChip
                  label={contrast.buttonOk ? t('Branding.passes') : t('Branding.fails')}
                  tone={contrast.buttonOk ? 'success' : 'error'}
                />
              </div>
            </div>
          ) : null}
          <TextField
            label={t('Branding.footer')}
            value={footerMd}
            onChange={(event) => setFooterMd(event.target.value)}
            disabled={disabled}
            multiline
            minRows={3}
            helperText={t('Branding.footerHint')}
            slotProps={{ htmlInput: { maxLength: 500 } }}
          />
          {postalAddressMissing ? (
            <Alert severity="warning">{t('Branding.postalAddressMissing')}</Alert>
          ) : null}
          {canWrite ? (
            <div className="flex justify-end">
              <Button type="submit" variant="contained" disabled={pending || !valid}>
                {pending ? t('Common.saving') : t('Common.save')}
              </Button>
            </div>
          ) : null}
        </form>
      </Paper>
    </div>
  );
}
