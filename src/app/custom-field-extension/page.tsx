"use client";

import { CreatorModal } from "@/components/creator/CreatorModal";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { useMarketplaceClient } from "@/utils/hooks/useMarketplaceClient";

export default function CustomFieldExtension() {
  const { client, error } = useMarketplaceClient();

  if (error) {
    return (
      <div className="p-4">
        <Alert variant="danger">
          <AlertDescription>{`Couldn't connect to Sitecore: ${error.message}`}</AlertDescription>
        </Alert>
      </div>
    );
  }
  if (!client) {
    return (
      <div className="flex justify-center p-6">
        <Spinner className="size-6" />
      </div>
    );
  }
  return <CreatorModal client={client} />;
}
