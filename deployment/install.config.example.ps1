# AMPHON Product Hub + SHOP-6.1 deployment configuration
# Copy this file to: deployment/install.config.ps1
# Do NOT put secret keys/passwords here. The installer asks for secrets securely.

$SupabaseProjectRef = "YOUR_PROJECT_REF"
$SupabaseUrl = "https://YOUR_PROJECT_REF.supabase.co"
$SupabasePublishableKey = "YOUR_SB_PUBLISHABLE_KEY"

$AppUrl = "https://hub.amphon.co.th"
$ShopUrl = "https://shop.amphon.co.th"
$LineUrl = "https://line.me/R/ti/p/@webuy"
$Phone = ""

$WorkerName = "amphon-product-images"
$R2BucketName = "amphon-product-images"

# Cloudflare will attach shop.amphon.co.th directly to the Astro Worker when true.
# The zone amphon.co.th must already be active in the Cloudflare account and the
# hostname must not have a conflicting DNS record.
$AttachShopCustomDomain = $true

# If a Stripe secret key is supplied during install, automatically create the
# webhook endpoint at <worker-url>/webhooks/stripe and save its signing secret
# into the Worker. If the endpoint already exists, the installer asks for whsec_...
$AutoCreateStripeWebhook = $true

# Dependency/build/deploy switches
$InstallDependencies = $true
$DeployWorker = $true
$DeployShop = $true
$RunLiveHttpSmoke = $true
