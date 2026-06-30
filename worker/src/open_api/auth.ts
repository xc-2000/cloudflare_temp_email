import { Hono } from 'hono'
import { Jwt } from 'hono/utils/jwt'

import utils, { checkCfTurnstile, getPasswords, getAdminPasswords, hashPassword } from '../utils';
import i18n from '../i18n';
import { findMailCodeByAddress } from '../mail_code';

const api = new Hono<HonoCustomType>()

api.get('/open_api/mail_code', async (c) => {
    const { token, limit, minutes, format } = c.req.query();
    const msgs = i18n.getMessagesbyContext(c);
    if (!token) {
        return c.text(msgs.InvalidAddressCredentialMsg, 401)
    }
    try {
        const payload = await Jwt.verify(token, c.env.JWT_SECRET, "HS256");
        const address = typeof payload.address === "string" ? payload.address : "";
        if (!address) {
            return c.text(msgs.InvalidAddressCredentialMsg, 401)
        }
        const result = await findMailCodeByAddress(c.env.DB, address, { limit, minutes });
        if (format === "json") {
            return c.json(result);
        }
        if (!result.success || !result.code) {
            return c.text("", 404);
        }
        return c.text(result.code);
    } catch (error) {
        return c.text(msgs.InvalidAddressCredentialMsg, 401)
    }
})

api.post('/open_api/site_login', async (c) => {
    const { password, cf_token } = await c.req.json();
    const msgs = i18n.getMessagesbyContext(c);
    if (utils.isGlobalTurnstileEnabled(c)) {
        try {
            await checkCfTurnstile(c, cf_token);
        } catch (error) {
            return c.text(msgs.TurnstileCheckFailedMsg, 400)
        }
    }
    const passwords = getPasswords(c);
    const hashedPasswords = await Promise.all(passwords.map(p => hashPassword(p)));
    if (!hashedPasswords.length || !password || !hashedPasswords.includes(password)) {
        return c.text(msgs.CustomAuthPasswordMsg, 401)
    }
    return c.json({ success: true })
})

api.post('/open_api/admin_login', async (c) => {
    const { password, cf_token } = await c.req.json();
    const msgs = i18n.getMessagesbyContext(c);
    if (utils.isGlobalTurnstileEnabled(c)) {
        try {
            await checkCfTurnstile(c, cf_token);
        } catch (error) {
            return c.text(msgs.TurnstileCheckFailedMsg, 400)
        }
    }
    const adminPasswords = getAdminPasswords(c);
    const hashedPasswords = await Promise.all(adminPasswords.map(p => hashPassword(p)));
    if (!hashedPasswords.length || !password || !hashedPasswords.includes(password)) {
        return c.text(msgs.NeedAdminPasswordMsg, 401)
    }
    return c.json({ success: true })
})

api.post('/open_api/credential_login', async (c) => {
    const { credential, cf_token } = await c.req.json();
    const msgs = i18n.getMessagesbyContext(c);
    if (utils.isGlobalTurnstileEnabled(c)) {
        try {
            await checkCfTurnstile(c, cf_token);
        } catch (error) {
            return c.text(msgs.TurnstileCheckFailedMsg, 400)
        }
    }
    if (!credential) {
        return c.text(msgs.InvalidAddressCredentialMsg, 401)
    }
    try {
        const payload = await Jwt.verify(credential, c.env.JWT_SECRET, "HS256");
        if (!payload.address) {
            return c.text(msgs.InvalidAddressCredentialMsg, 401)
        }
    } catch (error) {
        return c.text(msgs.InvalidAddressCredentialMsg, 401)
    }
    return c.json({ success: true })
})

export { api }
