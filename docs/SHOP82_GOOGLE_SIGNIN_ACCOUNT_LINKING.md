# SHOP-8.2 — Google Sign-In + Account Linking

## Scope

SHOP-8.2 adds Google OAuth as the second customer authentication method while keeping Email + Password from SHOP-8.1.

- Google Sign-In is available from login and signup pages.
- Supabase automatic identity linking is the primary duplicate-account prevention mechanism: a verified Google email matching an existing verified customer email links to the same Auth user.
- A signed-in customer can explicitly connect Google from `/account/` using Supabase manual identity linking.
- No Google unlink action is exposed in SHOP-8.2 to reduce accidental account lockout risk.
- Checkout remains guest-compatible until the later member-checkout activation phase.

## Production callback URLs

Application OAuth callback:

`https://shop.amphon.co.th/account/oauth-callback/`

Supabase project callback registered in Google Cloud:

`https://mfpdtlxwdbxitgfzdape.supabase.co/auth/v1/callback`

## Google Cloud configuration

Create a Web application OAuth client for AMPHON SHOP.

Authorized JavaScript origin:

`https://shop.amphon.co.th`

Authorized redirect URI:

`https://mfpdtlxwdbxitgfzdape.supabase.co/auth/v1/callback`

Use only the basic identity scopes required by Supabase Google Auth (`openid`, email and profile). Never commit the Google client secret to GitHub or expose it through `PUBLIC_*` variables.

## Supabase Auth configuration

Authentication > URL Configuration must allow:

`https://shop.amphon.co.th/account/oauth-callback/`

Authentication > Providers > Google:

- Google provider enabled
- Google OAuth Web Client ID configured
- Google OAuth Client Secret configured in Supabase only
- Manual identity linking enabled for the explicit "เชื่อม Google" action

## Identity rules

1. Google sign-in with the same verified email as an existing verified Email/Password user must resolve to the same `auth.users.id` through Supabase automatic linking.
2. `commerce_customer_profiles.auth_user_id` remains the canonical customer identity key, so automatic linking does not create a second customer profile.
3. Manual linking requires an existing signed-in customer session and uses `/auth/v1/user/identities/authorize` with the user's access token.
4. The Shop frontend uses only the Supabase project URL and publishable key. Service-role, `sb_secret_*`, Google client secret and Stripe secret values are forbidden in frontend source.

## Safety gate

Before marking SHOP-8.2 FINAL PASS:

- `npm run verify:shop81`
- `npm run verify:shop82`
- `npm run build`
- Login and Signup show Google entry points.
- Google entry point reaches Google OAuth without provider-disabled error.
- OAuth returns only to `shop.amphon.co.th/account/oauth-callback/`.
- Existing Email/Password account + same Google email resolves to one Auth user/customer profile.
- Signed-in Account page reports Google as linked after manual or automatic linking.
- `purchase_enabled = true`
- `member_checkout_required = false`
- `stripe_enabled = true`
- `stripe_promptpay_enabled = false`
- No real order/payment is created for acceptance.
