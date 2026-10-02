/**
 * Amazon SES v2 con mensaje en bruto (conserva Message-ID y List-Unsubscribe). Los rebotes y
 * quejas llegan por SNS al webhook del proveedor si se configura un Configuration Set.
 */
import { GetAccountCommand, SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import type { SesCredentials, SesSettings } from '@/core/providers/provider-config';
import type {
  EmailProvider,
  OutboundEmail,
  SendResult,
  VerifyResult,
} from '@/core/providers/ports';
import { buildMime } from './mime';

const AUTH_ERRORS = new Set([
  'UnrecognizedClientException',
  'InvalidClientTokenId',
  'SignatureDoesNotMatch',
  'AccessDeniedException',
  'ExpiredTokenException',
]);
const CONFIG_ERRORS = new Set([
  'MailFromDomainNotVerifiedException',
  'AccountSuspendedException',
  'SendingPausedException',
  'NotFoundException',
]);
const THROTTLE_ERRORS = new Set([
  'TooManyRequestsException',
  'LimitExceededException',
  'ThrottlingException',
]);

export function classifySesError(error: unknown): Exclude<SendResult, { ok: true }> {
  const name = error instanceof Error ? error.name : 'Error';
  const message = `${name}: ${error instanceof Error ? error.message.slice(0, 280) : ''}`;
  if (AUTH_ERRORS.has(name)) return { ok: false, code: 'AUTH', retryable: false, message };
  if (CONFIG_ERRORS.has(name)) return { ok: false, code: 'CONFIG', retryable: false, message };
  if (THROTTLE_ERRORS.has(name)) {
    return { ok: false, code: 'RATE_LIMITED', retryable: true, message, retryAfterMs: 5000 };
  }
  if (name === 'MessageRejected') return { ok: false, code: 'REJECTED', retryable: false, message };
  return { ok: false, code: 'TRANSIENT', retryable: true, message };
}

export class SesEmailProvider implements EmailProvider {
  private readonly client: SESv2Client;

  constructor(
    private readonly settings: SesSettings,
    credentials: SesCredentials,
  ) {
    this.client = new SESv2Client({
      region: settings.region,
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
      },
    });
  }

  async send(email: OutboundEmail): Promise<SendResult> {
    try {
      const output = await this.client.send(
        new SendEmailCommand({
          Content: { Raw: { Data: await buildMime(email) } },
          ...(this.settings.configurationSet
            ? { ConfigurationSetName: this.settings.configurationSet }
            : {}),
        }),
      );
      return { ok: true, providerMessageId: output.MessageId ?? email.messageId };
    } catch (error) {
      return classifySesError(error);
    }
  }

  async verify(): Promise<VerifyResult> {
    try {
      const account = await this.client.send(new GetAccountCommand({}));
      return account.SendingEnabled === false
        ? { ok: false, message: 'El envío está desactivado en la cuenta de SES' }
        : { ok: true };
    } catch (error) {
      return { ok: false, message: classifySesError(error).message };
    }
  }

  close(): void {
    this.client.destroy();
  }
}
