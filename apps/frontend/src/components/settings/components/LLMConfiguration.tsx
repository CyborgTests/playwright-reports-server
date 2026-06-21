import { Card, CardContent, CardHeader } from '@/components/ui/card';
import LLMAutomationSection from './LLMAutomationSection';
import LLMModelsConfiguration from './LLMModelsConfiguration';
import LLMPromptsSection from './LLMPromptsSection';
import LLMRoutingConfiguration from './LLMRoutingConfiguration';

export default function LLMConfiguration() {

  return (
    <Card id="llm" className="mb-6 scroll-mt-20 p-4">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-xl font-semibold">LLM Configuration</h2>
      </CardHeader>
      <CardContent className="divide-y divide-border [&>section]:py-6 [&>section:first-child]:pt-0 [&>section:last-child]:pb-0">
        <LLMModelsConfiguration />
        <LLMRoutingConfiguration />
        <LLMAutomationSection />
        <LLMPromptsSection />
      </CardContent>
    </Card>
  );
}
