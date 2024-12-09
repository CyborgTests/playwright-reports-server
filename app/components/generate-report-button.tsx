'use client';

import {
  Tooltip,
  Button,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  useDisclosure,
  ModalFooter,
  Autocomplete,
  AutocompleteItem,
} from '@nextui-org/react';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { type Result } from '../lib/storage';

import useQuery from '@/app/hooks/useQuery';
import useMutation from '@/app/hooks/useMutation';
import { invalidateCache } from '@/app/lib/query-cache';

interface DeleteProjectButtonProps {
  results: Result[];
  projects: string[];
  onGeneratedReport?: () => void;
}

export default function GenerateReportButton({
  results,
  projects,
  onGeneratedReport,
}: Readonly<DeleteProjectButtonProps>) {
  const queryClient = useQueryClient();
  const {
    mutate: generateReport,
    isPending,
    error,
  } = useMutation('/api/report/generate', {
    method: 'POST',
    onSuccess: (data: { reportId: string }) => {
      invalidateCache(queryClient, { queryKeys: ['/api/info'], predicate: '/api/report' });
      toast.success(`report ${data?.reportId} is generated`);
    },
  });

  const {
    data: resultProjects,
    error: resultProjectsError,
    isLoading: isResultProjectsLoading,
  } = useQuery<string[]>(`/api/result/projects`);

  const [projectName, setProjectName] = useState('');

  useEffect(() => {
    !projectName && setProjectName(projects?.at(0) ?? '');
  }, [projects]);

  const { isOpen, onOpen, onClose, onOpenChange } = useDisclosure();

  const GenerateReport = async () => {
    if (!results?.length) {
      return;
    }

    generateReport({ body: { resultsIds: results.map((r) => r.resultID), project: projectName } });

    setProjectName('');
    onClose();
    onGeneratedReport?.();
  };

  error && toast.error(error.message);

  return (
    <>
      <Tooltip color="secondary" content="Generate Report" placement="top">
        <Button color="secondary" isDisabled={!results?.length} isLoading={isPending} size="md" onClick={onOpen}>
          Generate Report
        </Button>
      </Tooltip>
      <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex flex-col gap-1">Generate report</ModalHeader>
              <ModalBody>
                <Autocomplete
                  allowsCustomValue
                  errorMessage={resultProjectsError?.message}
                  inputValue={projectName}
                  isDisabled={isPending}
                  isLoading={isResultProjectsLoading}
                  items={[...projects, ...(resultProjects ?? [])].map((project) => ({
                    label: project,
                    value: project,
                  }))}
                  label="Project name"
                  placeholder="leave empty if not required"
                  onInputChange={(value) => setProjectName(value)}
                  onSelectionChange={(value) => value && setProjectName(value?.toString() ?? '')}
                >
                  {(item) => <AutocompleteItem key={item.value}>{item.label}</AutocompleteItem>}
                </Autocomplete>
              </ModalBody>
              <ModalFooter>
                <Button color="danger" isDisabled={isPending} onClick={onClose}>
                  Close
                </Button>
                <Button color="success" isLoading={isPending} type="submit" onClick={GenerateReport}>
                  Generate
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </>
  );
}
