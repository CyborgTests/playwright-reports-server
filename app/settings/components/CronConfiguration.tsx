'use client';

import { Card, CardBody, CardHeader, Input, Button, Chip } from '@heroui/react';

import { ServerConfig } from '../types';

interface CronConfigurationProps {
  config: ServerConfig;
  tempConfig: ServerConfig;
  editingSection: 'none' | 'server' | 'jira' | 'cron';
  isUpdating: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onUpdateTempConfig: (updates: Partial<ServerConfig>) => void;
}

export default function CronConfiguration({
  config,
  tempConfig,
  editingSection,
  isUpdating,
  onEdit,
  onSave,
  onCancel,
  onUpdateTempConfig,
}: CronConfigurationProps) {
  return (
    <Card className="mb-6 p-4">
      <CardHeader
        className={`flex justify-between items-center ${editingSection === 'cron' ? 'bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-500' : ''}`}
      >
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold">Cron Settings</h2>
          {editingSection === 'cron' && (
            <Chip color="primary" size="sm" variant="flat">
              Editing
            </Chip>
          )}
        </div>
        {editingSection !== 'cron' ? (
          <Button color="primary" isDisabled={editingSection !== 'none'} onPress={onEdit}>
            {editingSection === 'none' ? 'Edit Configuration' : 'Section in Use'}
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button color="success" isLoading={isUpdating} onPress={onSave}>
              Save Changes
            </Button>
            <Button color="default" onPress={onCancel}>
              Cancel
            </Button>
          </div>
        )}
      </CardHeader>
      <CardBody>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2" htmlFor="result-expire-days">
              Result Expire Days
            </label>
            <Input
              id="result-expire-days"
              isDisabled={editingSection !== 'cron'}
              placeholder="30"
              type="number"
              value={
                editingSection === 'cron'
                  ? tempConfig.cron?.resultExpireDays?.toString() || ''
                  : config.cron?.resultExpireDays?.toString() || ''
              }
              onChange={(e) => {
                if (editingSection === 'cron') {
                  onUpdateTempConfig({
                    cron: {
                      ...tempConfig.cron,
                      resultExpireDays: parseInt(e.target.value) || undefined,
                    },
                  });
                }
              }}
            />
            <p className="text-xs text-gray-500 mt-1">Number of days before test results are automatically deleted</p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2" htmlFor="result-expire-cron-schedule">
              Result Expire Cron Schedule
            </label>
            <Input
              id="result-expire-cron-schedule"
              isDisabled={editingSection !== 'cron'}
              placeholder="0 2 * * *"
              value={
                editingSection === 'cron'
                  ? tempConfig.cron?.resultExpireCronSchedule || ''
                  : config.cron?.resultExpireCronSchedule || ''
              }
              onChange={(e) => {
                if (editingSection === 'cron') {
                  onUpdateTempConfig({
                    cron: {
                      ...tempConfig.cron,
                      resultExpireCronSchedule: e.target.value,
                    },
                  });
                }
              }}
            />
            <p className="text-xs text-gray-500 mt-1">
              Cron expression for when to run result cleanup (e.g., &quot;0 2 * * *&quot; for daily at 2 AM)
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2" htmlFor="report-expire-days">
              Report Expire Days
            </label>
            <Input
              id="report-expire-days"
              isDisabled={editingSection !== 'cron'}
              placeholder="90"
              type="number"
              value={
                editingSection === 'cron'
                  ? tempConfig.cron?.reportExpireDays?.toString() || ''
                  : config.cron?.reportExpireDays?.toString() || ''
              }
              onChange={(e) => {
                if (editingSection === 'cron') {
                  onUpdateTempConfig({
                    cron: {
                      ...tempConfig.cron,
                      reportExpireDays: parseInt(e.target.value) || undefined,
                    },
                  });
                }
              }}
            />
            <p className="text-xs text-gray-500 mt-1">Number of days before test reports are automatically deleted</p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2" htmlFor="report-expire-cron-schedule">
              Report Expire Cron Schedule
            </label>
            <Input
              id="report-expire-cron-schedule"
              isDisabled={editingSection !== 'cron'}
              placeholder="0 3 * * *"
              value={
                editingSection === 'cron'
                  ? tempConfig.cron?.reportExpireCronSchedule || ''
                  : config.cron?.reportExpireCronSchedule || ''
              }
              onChange={(e) => {
                if (editingSection === 'cron') {
                  onUpdateTempConfig({
                    cron: {
                      ...tempConfig.cron,
                      reportExpireCronSchedule: e.target.value,
                    },
                  });
                }
              }}
            />
            <p className="text-xs text-gray-500 mt-1">
              Cron expression for when to run report cleanup (e.g., &quot;0 3 * * *&quot; for daily at 3 AM)
            </p>
          </div>

          {editingSection === 'cron' && (
            <Button
              color="warning"
              size="sm"
              onPress={() =>
                onUpdateTempConfig({
                  cron: {
                    resultExpireDays: 30,
                    resultExpireCronSchedule: '0 2 * * *',
                    reportExpireDays: 90,
                    reportExpireCronSchedule: '0 3 * * *',
                  },
                })
              }
            >
              Reset Cron Settings
            </Button>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
