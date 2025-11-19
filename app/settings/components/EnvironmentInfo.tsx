'use client';

import { Card, CardBody, CardHeader, Skeleton } from '@heroui/react';

import ServerCache from './ServerCache';

import { useAuthConfig } from '@/app/hooks/useAuthConfig';

export default function EnvironmentInfo() {
  const { config: envInfo, isLoading } = useAuthConfig();

  return (
    <Card className="p-4">
      <CardHeader>
        <h2 className="text-xl font-semibold">Environment Information</h2>
      </CardHeader>
      <CardBody>
        <div className="space-y-4">
          <div>
            <span className="block text-sm font-medium mb-1">Authentication</span>
            {isLoading ? (
              <Skeleton className="h-5 w-20 rounded-lg" />
            ) : (
              <p className="text-sm text-gray-600">{envInfo?.authRequired ? 'Enabled' : 'Disabled'}</p>
            )}
          </div>
          <div>
            <span className="block text-sm font-medium mb-1">Server Cache</span>
            {isLoading ? (
              <Skeleton className="h-5 w-20 rounded-lg" />
            ) : (
              <ServerCache isEnabled={envInfo?.serverCache} />
            )}
          </div>
          <div>
            <span className="block text-sm font-medium mb-1">Data Storage</span>
            {isLoading ? (
              <Skeleton className="h-5 w-20 rounded-lg" />
            ) : (
              <p className="text-sm text-gray-600">{envInfo?.dataStorage || 'fs'}</p>
            )}
          </div>
          {envInfo?.s3Endpoint && (
            <div>
              <span className="block text-sm font-medium mb-1">S3 Storage</span>
              <p className="text-sm text-gray-600">Endpoint: {envInfo.s3Endpoint}</p>
              <p className="text-sm text-gray-600">Bucket: {envInfo.s3Bucket}</p>
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
