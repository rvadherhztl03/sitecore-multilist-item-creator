import type { PageContext } from '@/lib/fieldContext';
import type { CreatorConfig } from '@/lib/config';
import type { SdkClient } from '@/lib/sdk';
import { Button } from '@/components/ui/button';

// Placeholder until the next commit builds the real Setup view.
export function SetupView({ onBack }: { client: SdkClient; page: PageContext; initial?: CreatorConfig; onBack(): void }) {
  return <Button onClick={onBack}>Back</Button>;
}
