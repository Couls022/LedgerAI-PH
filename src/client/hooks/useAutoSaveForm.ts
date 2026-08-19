import { useState, useEffect, useRef, useCallback } from 'react';

export interface AutoSaveStatus {
  hasDraft: boolean;
  lastSavedAt: Date | null;
  isSaving: boolean;
  isDirty: boolean;
}

export function useAutoSaveForm<T extends Record<string, any>>(
  storageKey: string,
  initialValues: T
) {
  const [formData, setFormData] = useState<T>(initialValues);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);

  const initialValuesRef = useRef(initialValues);

  // Check if current form is dirty compared to initial
  const isDirty = JSON.stringify(formData) !== JSON.stringify(initialValuesRef.current);

  // Load existing draft on mount / key change
  useEffect(() => {
    try {
      const savedRaw = localStorage.getItem(storageKey);
      if (savedRaw) {
        const parsed = JSON.parse(savedRaw);
        if (parsed && parsed.data) {
          setHasDraft(true);
          if (parsed.savedAt) {
            setLastSavedAt(new Date(parsed.savedAt));
          }
        }
      }
    } catch (err) {
      console.warn('[AutoSave] Error checking saved draft:', err);
    }
  }, [storageKey]);

  // Auto-save form data to localStorage whenever formData changes and is dirty
  useEffect(() => {
    if (!isDirty) return;

    setIsSaving(true);
    const timeout = setTimeout(() => {
      try {
        const now = new Date();
        const payload = {
          data: formData,
          savedAt: now.toISOString(),
        };
        localStorage.setItem(storageKey, JSON.stringify(payload));
        setLastSavedAt(now);
        setHasDraft(true);
      } catch (err) {
        console.warn('[AutoSave] Save error:', err);
      } finally {
        setIsSaving(false);
      }
    }, 400); // 400ms debounce

    return () => clearTimeout(timeout);
  }, [formData, isDirty, storageKey]);

  // Unsaved changes window prompt (beforeunload)
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = 'You have unsaved document creation draft changes. Are you sure you want to leave?';
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  const updateField = useCallback(<K extends keyof T>(field: K, value: T[K]) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  }, []);

  const restoreDraft = useCallback(() => {
    try {
      const savedRaw = localStorage.getItem(storageKey);
      if (savedRaw) {
        const parsed = JSON.parse(savedRaw);
        if (parsed && parsed.data) {
          setFormData(parsed.data);
          if (parsed.savedAt) setLastSavedAt(new Date(parsed.savedAt));
          return true;
        }
      }
    } catch (err) {
      console.error('[AutoSave] Restore failed:', err);
    }
    return false;
  }, [storageKey]);

  const clearDraft = useCallback(() => {
    try {
      localStorage.removeItem(storageKey);
    } catch (err) {
      console.warn('[AutoSave] Clear draft error:', err);
    }
    setHasDraft(false);
    setLastSavedAt(null);
  }, [storageKey]);

  const resetForm = useCallback((newInitial?: T) => {
    const vals = newInitial || initialValuesRef.current;
    setFormData(vals);
    clearDraft();
  }, [clearDraft]);

  return {
    formData,
    setFormData,
    updateField,
    isDirty,
    isSaving,
    hasDraft,
    lastSavedAt,
    restoreDraft,
    clearDraft,
    resetForm,
  };
}
