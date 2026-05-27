// Twilio Programmable Messaging.
//
// Invariant pre-registers an A2P 10DLC campaign under our parent brand so end
// users skip the 10-15 day approval gauntlet. Each user's traffic flows
// through our shared Messaging Service SID; carrier filtering and throughput
// are managed centrally.
//
// Required env:
//   TWILIO_ACCOUNT_SID      — starts with AC...
//   TWILIO_AUTH_TOKEN       — 32-char secret from the Twilio console
//   TWILIO_MESSAGING_SERVICE_SID — starts with MG... (preferred over a single
//                                  phone number; it routes across a sender pool
//                                  and inherits our A2P registration)

import {
  Provider,
  ProviderCategory,
  ProviderInfo,
  QueryResult,
} from "./types.js";

const SID_ENV = "TWILIO_ACCOUNT_SID";
const TOKEN_ENV = "TWILIO_AUTH_TOKEN";
const MSG_SVC_ENV = "TWILIO_MESSAGING_SERVICE_SID";

function hasCreds(): boolean {
  return Boolean(process.env[SID_ENV] && process.env[TOKEN_ENV]);
}

function basicAuthHeader(): string {
  const sid = process.env[SID_ENV]!;
  const token = process.env[TOKEN_ENV]!;
  return "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");
}

export class TwilioProvider implements Provider {
  info: ProviderInfo = {
    id: "twilio",
    name: "Twilio Programmable Messaging",
    category: ProviderCategory.CLOUD,
    description:
      "Send SMS and look up phone numbers via Twilio. Pre-registered A2P 10DLC campaign means user traffic sends immediately — no carrier approval wait.",
    availableActions: [
      {
        action: "send_sms",
        description:
          "Send a text message to a US/international phone number. Returns the message SID on success.",
        parameters: {
          to: {
            type: "string",
            description:
              "Destination phone number in E.164 format (e.g. +14155552671)",
            required: true,
          },
          body: {
            type: "string",
            description: "Message text (max 1600 chars; longer is segmented)",
            required: true,
          },
        },
      },
      {
        action: "lookup_phone",
        description:
          "Validate a phone number and return carrier + country info.",
        parameters: {
          phone: {
            type: "string",
            description: "Phone number in E.164 format",
            required: true,
          },
        },
      },
      {
        action: "message_status",
        description:
          "Check delivery status of a previously sent message by its SID.",
        parameters: {
          message_sid: {
            type: "string",
            description: "Message SID returned by send_sms (starts with SM...)",
            required: true,
          },
        },
      },
    ],
    requiresApiKey: true,
  };

  isAvailable(): boolean {
    return hasCreds();
  }

  async query(
    action: string,
    params: Record<string, unknown>,
  ): Promise<QueryResult> {
    if (!hasCreds()) {
      return {
        success: false,
        error: "Twilio credentials not configured (TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN)",
      };
    }

    const sid = process.env[SID_ENV]!;

    try {
      switch (action) {
        case "send_sms": {
          const to = params.to as string;
          const body = params.body as string;
          if (!to || !body) {
            return {
              success: false,
              error: "Missing required parameters: to, body",
            };
          }
          const msgSvc = process.env[MSG_SVC_ENV];
          if (!msgSvc) {
            return {
              success: false,
              error:
                "TWILIO_MESSAGING_SERVICE_SID not set. Use Messaging Service for A2P pooling.",
            };
          }

          const form = new URLSearchParams({
            To: to,
            Body: body,
            MessagingServiceSid: msgSvc,
          });

          const res = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
            {
              method: "POST",
              headers: {
                Authorization: basicAuthHeader(),
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: form.toString(),
            },
          );
          if (!res.ok) {
            const err = await res.text();
            return {
              success: false,
              error: `Twilio error (${res.status}): ${err.slice(0, 200)}`,
            };
          }
          const data = (await res.json()) as {
            sid: string;
            status: string;
            to: string;
            from: string;
            num_segments: string;
            price?: string;
          };
          return {
            success: true,
            data: {
              message_sid: data.sid,
              status: data.status,
              to: data.to,
              from: data.from,
              num_segments: Number(data.num_segments),
              estimated_price: data.price,
            },
          };
        }

        case "lookup_phone": {
          const phone = params.phone as string;
          if (!phone) {
            return { success: false, error: "Missing required parameter: phone" };
          }
          const res = await fetch(
            `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(phone)}?Fields=line_type_intelligence`,
            { headers: { Authorization: basicAuthHeader() } },
          );
          if (!res.ok) {
            return { success: false, error: `Twilio lookup error (${res.status})` };
          }
          const data = (await res.json()) as {
            valid: boolean;
            phone_number: string;
            country_code: string;
            line_type_intelligence?: { type: string; carrier_name?: string };
          };
          return {
            success: true,
            data: {
              valid: data.valid,
              phone_number: data.phone_number,
              country_code: data.country_code,
              line_type: data.line_type_intelligence?.type,
              carrier: data.line_type_intelligence?.carrier_name,
            },
          };
        }

        case "message_status": {
          const messageSid = params.message_sid as string;
          if (!messageSid) {
            return {
              success: false,
              error: "Missing required parameter: message_sid",
            };
          }
          const res = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages/${messageSid}.json`,
            { headers: { Authorization: basicAuthHeader() } },
          );
          if (!res.ok) {
            return {
              success: false,
              error: `Twilio status error (${res.status})`,
            };
          }
          const data = (await res.json()) as {
            sid: string;
            status: string;
            error_code: number | null;
            error_message: string | null;
            date_sent: string;
            price: string | null;
          };
          return {
            success: true,
            data: {
              message_sid: data.sid,
              status: data.status,
              error_code: data.error_code,
              error_message: data.error_message,
              sent_at: data.date_sent,
              price: data.price,
            },
          };
        }

        default:
          return { success: false, error: `Unknown action: ${action}` };
      }
    } catch (err) {
      return {
        success: false,
        error: `Request failed: ${(err as Error).message}`,
      };
    }
  }
}
