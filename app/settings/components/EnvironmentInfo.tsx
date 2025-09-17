'use client';

import { Card, CardBody, CardHeader } from '@heroui/react';

export default function EnvironmentInfo() {
  return (
    <Card className="p-4">
      <CardHeader>
        <h2 className="text-xl font-semibold">Environment Information</h2>
      </CardHeader>
      <CardBody>
        <div className="space-y-4">
          <div>
            <span className="block text-sm font-medium mb-1">Authentication</span>
            <p className="text-sm text-gray-600">{process.env.API_TOKEN ? 'Enabled' : 'Disabled'}</p>
          </div>
          <div>
            <span className="block text-sm font-medium mb-1">Server Cache</span>
            <p className="text-sm text-gray-600">{process.env.USE_SERVER_CACHE === 'true' ? 'Enabled' : 'Disabled'}</p>
          </div>
          <div>
            <span className="block text-sm font-medium mb-1">Data Storage</span>
            <p className="text-sm text-gray-600">{process.env.DATA_STORAGE || 'fs'}</p>
          </div>
          {process.env.S3_ENDPOINT && (
            <div>
              <span className="block text-sm font-medium mb-1">S3 Storage</span>
              <p className="text-sm text-gray-600">Endpoint: {process.env.S3_ENDPOINT}</p>
              <p className="text-sm text-gray-600">Bucket: {process.env.S3_BUCKET}</p>
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
