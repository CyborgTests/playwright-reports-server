import {
  type ChannelType,
  defaultEventTemplate,
  defaultScheduleTemplate,
  type EventCondition,
  type EventRule,
  type NotificationRule,
  type ProjectFilter,
  type ScheduleCondition,
  type ScheduleRule,
} from '@playwright-reports/shared';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ProjectFilterEditor } from './ProjectFilterEditor';
import { ScheduleFields } from './ScheduleFields';
import { SendTestPanel } from './SendTestPanel';
import { SlackBlockEditor } from './SlackBlockEditor';
import { SlackPreview } from './SlackPreview';
import {
  eventVariables,
  sampleEventContext,
  sampleScheduleContext,
  scheduleVariables,
} from './templating';
import { WebhookPreview, WebhookTemplateEditor } from './WebhookTemplateEditor';

interface RuleFormDialogProps {
  open: boolean;
  rule?: NotificationRule;
  channelType: ChannelType;
  channelId: string;
  onCancel: () => void;
  onSubmit: (rule: NotificationRule) => void;
}

const EVENT_CONDITION_LABELS: Record<EventCondition, string> = {
  always: 'Always — every report',
  has_failures: 'Has failures (failed > 0)',
  pass_rate_below_100: 'Pass rate < 100% (failures OR flakies)',
  recovered_to_clean: 'Recovered to clean (back to 100% pass)',
  recovered_no_hard_failures: 'Recovered — no hard failures (flakies OK)',
  new_regressions: 'New regressions opened in this report',
  resolved_regressions: 'Regressions resolved in this report',
};

function newEventRule(channelType: ChannelType): EventRule {
  const condition: EventCondition = 'has_failures';
  return {
    id: crypto.randomUUID(),
    kind: 'event',
    enabled: true,
    event: 'report_uploaded',
    condition,
    projectFilter: { mode: 'all' },
    template: defaultEventTemplate(channelType, condition),
  };
}

function newScheduleRule(channelType: ChannelType): ScheduleRule {
  const condition: ScheduleCondition = 'always';
  return {
    id: crypto.randomUUID(),
    kind: 'schedule',
    enabled: true,
    cadence: 'daily',
    sendAt: '09:00',
    window: 'last_24h',
    condition,
    projectFilter: { mode: 'all' },
    template: defaultScheduleTemplate(channelType, condition),
  };
}

export function RuleFormDialog({
  open,
  rule,
  channelType,
  channelId,
  onCancel,
  onSubmit,
}: Readonly<RuleFormDialogProps>) {
  const isEdit = !!rule;

  const [draft, setDraft] = useState<NotificationRule>(() => rule ?? newEventRule(channelType));

  useEffect(() => {
    if (open) {
      setDraft(rule ?? newEventRule(channelType));
    }
  }, [open, rule, channelType]);

  const switchKind = (kind: 'event' | 'schedule') => {
    if (kind === draft.kind) return;
    setDraft(kind === 'event' ? newEventRule(channelType) : newScheduleRule(channelType));
  };

  const updateEventCondition = (condition: EventCondition) => {
    if (draft.kind !== 'event') return;
    const wasDefault =
      draft.template &&
      isSameTemplate(draft.template, defaultEventTemplate(channelType, draft.condition));
    setDraft({
      ...draft,
      condition,
      template: wasDefault ? defaultEventTemplate(channelType, condition) : draft.template,
    });
  };

  const updateScheduleCondition = (condition: ScheduleCondition) => {
    if (draft.kind !== 'schedule') return;
    const wasDefault =
      draft.template &&
      isSameTemplate(draft.template, defaultScheduleTemplate(channelType, draft.condition));
    setDraft({
      ...draft,
      condition,
      template: wasDefault ? defaultScheduleTemplate(channelType, condition) : draft.template,
    });
  };

  const updateProjectFilter = (filter: ProjectFilter) => {
    setDraft({ ...draft, projectFilter: filter });
  };

  const updateTemplate = (template: NotificationRule['template']) => {
    setDraft({ ...draft, template });
  };

  const variables: readonly string[] = useMemo(() => {
    if (draft.kind === 'event') return eventVariables(draft.condition);
    return scheduleVariables();
  }, [draft]);

  const sample = useMemo(() => {
    if (draft.kind === 'event') return sampleEventContext(draft.condition);
    return sampleScheduleContext(draft.condition);
  }, [draft]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit rule' : 'Add rule'}</DialogTitle>
          <DialogDescription>
            Configure when to fire and how the message should look.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
          <div className="space-y-4">
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                When
              </h3>

              <div className="space-y-2">
                <Label htmlFor="rule-kind">Trigger</Label>
                <Select
                  value={draft.kind}
                  onValueChange={(v) => switchKind(v as 'event' | 'schedule')}
                >
                  <SelectTrigger id="rule-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="event">On a report upload</SelectItem>
                    <SelectItem value="schedule">On a schedule</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {draft.kind === 'event' ? (
                <div className="space-y-2">
                  <Label htmlFor="event-condition">Send when</Label>
                  <Select
                    value={draft.condition}
                    onValueChange={(v) => updateEventCondition(v as EventCondition)}
                  >
                    <SelectTrigger id="event-condition">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(EVENT_CONDITION_LABELS) as EventCondition[]).map((c) => (
                        <SelectItem key={c} value={c}>
                          {EVENT_CONDITION_LABELS[c]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <ScheduleFields
                  rule={draft}
                  onChange={(patch) => setDraft({ ...draft, ...patch })}
                  onConditionChange={updateScheduleCondition}
                />
              )}

              <ProjectFilterEditor filter={draft.projectFilter} onChange={updateProjectFilter} />
            </section>

            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Template
              </h3>
              {channelType === 'slack' ? (
                <SlackBlockEditor
                  blocks={draft.template?.provider === 'slack' ? draft.template.blocks : []}
                  variables={variables}
                  onChange={(blocks) => updateTemplate({ provider: 'slack', blocks })}
                />
              ) : (
                <WebhookTemplateEditor
                  bodyJson={draft.template?.provider === 'webhook' ? draft.template.bodyJson : ''}
                  onChange={(bodyJson) => updateTemplate({ provider: 'webhook', bodyJson })}
                />
              )}
            </section>
          </div>

          <div className="space-y-3 lg:sticky lg:top-4 self-start">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Preview
            </h3>
            {channelType === 'slack' ? (
              <SlackPreview
                blocks={draft.template?.provider === 'slack' ? draft.template.blocks : []}
                variables={variables}
                sample={sample}
              />
            ) : (
              <WebhookPreview
                bodyJson={draft.template?.provider === 'webhook' ? draft.template.bodyJson : ''}
                variables={variables}
                sample={sample}
              />
            )}

            <SendTestPanel channelId={channelId} draft={draft} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => onSubmit(draft)}>{isEdit ? 'Save' : 'Add'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function isSameTemplate(a: NotificationRule['template'], b: NotificationRule['template']): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
