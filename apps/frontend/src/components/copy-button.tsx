import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from './ui/button';

interface CopyButtonProps {
  content: string;
  size?: 'sm' | 'md' | 'lg' | 'icon';
  variant?: 'default' | 'ghost' | 'outline';
}

export function CopyButton({ content, size = 'sm', variant = 'ghost' }: Readonly<CopyButtonProps>) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      toast.success('Copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast.error(`Failed to copy to clipboard: ${error}`);
    }
  };

  return (
    <Button
      size={size === 'sm' ? 'sm' : size === 'icon' ? 'icon' : 'default'}
      variant={variant}
      onClick={handleCopy}
      className="opacity-0 group-hover:opacity-100 transition-opacity"
    >
      {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
    </Button>
  );
}
