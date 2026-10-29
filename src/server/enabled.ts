import { isPluginEnabled, withTenantTx } from "@appointit/plugin-sdk/server";
import { DENTAL_PLUGIN_ID } from "./history/consent";

/** Whether the business has switched the dental plugin on. Package plugins are off until then, so the daily tasks skip the tenant. */
export function isDentalEnabled(tenantId: string): Promise<boolean> {
  return withTenantTx(tenantId, (tx) => isPluginEnabled(tx, DENTAL_PLUGIN_ID));
}
