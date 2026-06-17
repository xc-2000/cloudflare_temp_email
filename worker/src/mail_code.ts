import { Context } from "hono";

import { commonParseMail } from "./common";
import { resolveRawEmail } from "./gzip";
import { RawMailRow } from "./models";

const DEFAULT_CODE_QUERY_LIMIT = 10;
const MAX_CODE_QUERY_LIMIT = 50;
const DEFAULT_CODE_QUERY_MINUTES = 30;
const MAX_CODE_QUERY_MINUTES = 1440;

type VerificationCodeCandidate = {
    code: string;
    source: "metadata" | "subject" | "text" | "html";
}

const parsePositiveInt = (
    value: string | undefined,
    defaultValue: number,
    maxValue: number
): number => {
    if (!value) return defaultValue;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) return defaultValue;
    return Math.min(parsed, maxValue);
}

const stripHtml = (html: string): string => {
    return html
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&#(\d+);/g, (_, value) => String.fromCharCode(Number.parseInt(value, 10)))
        .replace(/\s+/g, " ")
        .trim();
}

const collectCodesFromMetadata = (metadata: string | undefined): VerificationCodeCandidate[] => {
    if (!metadata) return [];
    try {
        const parsed = JSON.parse(metadata);
        if (parsed?.ai_extract?.type === "auth_code" && parsed.ai_extract.result) {
            return [{ code: String(parsed.ai_extract.result), source: "metadata" }];
        }
        const codes = parsed?.verificationCodes;
        if (Array.isArray(codes)) {
            return codes
                .filter((item) => typeof item === "string" || typeof item === "number")
                .map((item) => ({ code: String(item), source: "metadata" as const }));
        }
    } catch (e) {
        console.warn("Failed to parse mail metadata", e);
    }
    return [];
}

const collectCodesFromText = (
    text: string,
    source: VerificationCodeCandidate["source"]
): VerificationCodeCandidate[] => {
    if (!text) return [];
    const candidates: VerificationCodeCandidate[] = [];
    const normalizedText = text.replace(/\s+/g, " ");
    const contextKeywords = [
        "\u9a8c\u8bc1\u7801",
        "\u6821\u9a8c\u7801",
        "\u52a8\u6001\u7801",
        "\u5b89\u5168\u7801",
        "\u786e\u8ba4\u7801",
        "\u9a8c\u8bc1\u4ee3\u7801",
        "verification code",
        "verify code",
        "security code",
        "login code",
        "one[-\\s]?time code",
        "passcode",
        "code",
    ].join("|");
    const contextPattern = new RegExp(
        `(?:${contextKeywords})[^\\dA-Za-z]{0,20}([A-Za-z0-9][A-Za-z0-9 -]{2,14}[A-Za-z0-9])`,
        "gi"
    );
    for (const match of normalizedText.matchAll(contextPattern)) {
        const code = match[1].replace(/[\s-]/g, "");
        if (/^(?=.*\d)[A-Za-z0-9]{4,8}$/.test(code)) {
            candidates.push({ code, source });
        }
    }
    if (candidates.length > 0) return candidates;

    const fallbackPattern = /(?<![A-Za-z0-9])(\d{4,8}|[A-Z0-9]{6,8})(?![A-Za-z0-9])/g;
    for (const match of normalizedText.matchAll(fallbackPattern)) {
        candidates.push({ code: match[1], source });
    }
    return candidates;
}

const uniqueCandidates = (candidates: VerificationCodeCandidate[]): VerificationCodeCandidate[] => {
    const seen = new Set<string>();
    return candidates.filter((item) => {
        const key = `${item.code}:${item.source}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

const extractCodesFromMail = async (row: RawMailRow): Promise<{
    candidates: VerificationCodeCandidate[];
    subject: string;
    sender: string;
}> => {
    const raw = await resolveRawEmail(row);
    const parsedEmail = raw ? await commonParseMail({ rawEmail: raw }) : undefined;
    const subject = parsedEmail?.subject || "";
    const sender = parsedEmail?.sender || row.source || "";
    return {
        subject,
        sender,
        candidates: uniqueCandidates([
            ...collectCodesFromMetadata(row.metadata),
            ...collectCodesFromText(subject, "subject"),
            ...collectCodesFromText(parsedEmail?.text || "", "text"),
            ...collectCodesFromText(stripHtml(parsedEmail?.html || ""), "html"),
        ]),
    };
}

export const getMailCodeByAddress = async (
    c: Context<HonoCustomType>,
    address: string,
    options: {
        limit?: string;
        minutes?: string;
    } = {}
): Promise<Response> => {
    const normalizedAddress = address.trim().toLowerCase();
    if (!normalizedAddress) {
        return c.json({ error: "address is required" }, 400);
    }
    const queryLimit = parsePositiveInt(options.limit, DEFAULT_CODE_QUERY_LIMIT, MAX_CODE_QUERY_LIMIT);
    const queryMinutes = parsePositiveInt(options.minutes, DEFAULT_CODE_QUERY_MINUTES, MAX_CODE_QUERY_MINUTES);
    const { results } = await c.env.DB.prepare(
        `SELECT * FROM raw_mails`
        + ` WHERE lower(address) = ?`
        + ` AND created_at >= datetime('now', ?)`
        + ` ORDER BY id DESC LIMIT ?`
    ).bind(normalizedAddress, `-${queryMinutes} minutes`, queryLimit).all<RawMailRow>();

    for (const row of results) {
        const extracted = await extractCodesFromMail(row);
        if (extracted.candidates.length > 0) {
            return c.json({
                success: true,
                address: normalizedAddress,
                code: extracted.candidates[0].code,
                source: extracted.candidates[0].source,
                candidates: extracted.candidates,
                mail: {
                    id: row.id,
                    from: extracted.sender,
                    subject: extracted.subject,
                    created_at: row.created_at,
                },
            });
        }
    }

    return c.json({
        success: false,
        address: normalizedAddress,
        code: null,
        candidates: [],
        scanned: results.length,
    });
}
