import React from 'react';
import LicenseActivation from './LicenseActivation';

interface LicenseImportProps {
  onSuccess?: () => void;
  onCancel?: () => void;
  isModal?: boolean;
}

export default function LicenseImport(props: LicenseImportProps) {
  return <LicenseActivation {...props} />;
}
