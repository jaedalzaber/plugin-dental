// Dental sections of the patient page: medical history & insurance, chart, treatment plans & recall.
// Each tab is owned by its own feature folder; this file only lays them out.
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@appointit/ui";
import { useT } from "@appointit/i18n/react";
import { useAdmin } from "@appointit/plugin-sdk/client";
import { ChartTab } from "./chart/ChartTab";
import { HistoryTab } from "./history/HistoryTab";
import { PlansTab } from "./plans/PlansTab";

export function DentalPatientTabs({ customerId }: { customerId: string }) {
  const t = useT();
  const { can } = useAdmin();
  if (!can("health.read")) return null;
  return (
    <Tabs defaultValue="history">
      <TabsList>
        <TabsTrigger value="history">{t("dental.tabHistory")}</TabsTrigger>
        <TabsTrigger value="chart">{t("dental.tabChart")}</TabsTrigger>
        <TabsTrigger value="plans">{t("dental.tabPlans")}</TabsTrigger>
      </TabsList>
      <TabsContent value="history">
        <HistoryTab customerId={customerId} />
      </TabsContent>
      <TabsContent value="chart">
        <ChartTab customerId={customerId} />
      </TabsContent>
      <TabsContent value="plans">
        <PlansTab customerId={customerId} />
      </TabsContent>
    </Tabs>
  );
}
