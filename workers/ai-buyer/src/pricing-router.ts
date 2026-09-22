import { runPricingForCase as runLegacyPricingForCase, type PricingEnv } from './pricing-engine'
import { runSpecPricingForCase } from './spec-pricing-engine'

export async function runPricingForCase(env: PricingEnv, caseId: string) {
  const spec = await runSpecPricingForCase(env, caseId)
  if (spec.handled) return spec.result
  return runLegacyPricingForCase(env, caseId)
}
