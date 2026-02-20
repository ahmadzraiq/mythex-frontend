'use client';

/**
 * Form with react-hook-form + yup validation - works with JSON-configured rules
 */

import React, { createContext, useContext, useEffect } from 'react';
import { useForm, FormProvider, Controller } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import { Input, InputField } from '@/components/ui/input';
import {
  FormControl,
  FormControlLabel,
  FormControlLabelText,
} from '@/components/ui/form-control';
import { Text } from '@/components/ui/text';
import { Box } from '@/components/ui/box';
import { Button, ButtonText } from '@/components/ui/button';

export interface ValidationRule {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  pattern?: string;
  equals?: string;
  message?: string;
}

function buildYupSchema(rules: Record<string, ValidationRule>) {
  const leafSchemas: Record<string, yup.AnySchema> = {};

  for (const [path, rule] of Object.entries(rules)) {
    const isNumber = (rule as { type?: string }).type === 'number' || rule.min != null;
    let schema: yup.AnySchema = isNumber
      ? yup
          .number()
          .transform((v) => {
            if (v === '' || v == null) return undefined;
            const n = Number(v);
            return Number.isNaN(n) ? undefined : n;
          })
      : yup.string();

    if (rule.required) {
      schema = schema.required(rule.message ?? 'Required');
    }
    if (rule.minLength != null && !isNumber) {
      schema = (schema as yup.StringSchema).min(rule.minLength, rule.message ?? `Min ${rule.minLength} characters`);
    }
    if (rule.maxLength != null && !isNumber) {
      schema = (schema as yup.StringSchema).max(rule.maxLength, rule.message ?? `Max ${rule.maxLength} characters`);
    }
    if (rule.min != null) {
      schema = (schema as yup.NumberSchema).min(rule.min, rule.message ?? `Must be at least ${rule.min}`);
    }
    if (rule.pattern === 'email' && !isNumber) {
      schema = (schema as yup.StringSchema).email(rule.message ?? 'Invalid email');
    } else if (rule.pattern && !isNumber) {
      schema = (schema as yup.StringSchema).matches(new RegExp(rule.pattern), rule.message ?? 'Invalid format');
    }
    if (rule.equals != null && !isNumber) {
      // When both fields share the same parent (e.g. form.password, form.confirmPassword),
      // yup.ref needs the sibling name, not the full path
      const pathParts = path.split('.');
      const equalsParts = rule.equals.split('.');
      const sameParent =
        pathParts.length === equalsParts.length &&
        pathParts.slice(0, -1).join('.') === equalsParts.slice(0, -1).join('.');
      const refPath = sameParent ? equalsParts[equalsParts.length - 1]! : rule.equals;
      schema = (schema as yup.StringSchema).oneOf([yup.ref(refPath)], rule.message ?? 'Must match');
    }

    leafSchemas[path] = schema;
  }

  // Build nested object schema from paths like "form.name" -> { form: { name: schema } }
  const root: Record<string, unknown> = {};
  for (const [path, schema] of Object.entries(leafSchemas)) {
    const parts = path.split('.');
    let current = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!(part in current) || typeof (current as Record<string, unknown>)[part] !== 'object') {
        (current as Record<string, unknown>)[part] = {};
      }
      current = (current as Record<string, unknown>)[part] as Record<string, unknown>;
    }
    (current as Record<string, unknown>)[parts[parts.length - 1]] = schema;
  }

  return yup.object().shape(buildNestedShape(root));
}

function buildNestedShape(obj: Record<string, unknown>): Record<string, yup.AnySchema> {
  const result: Record<string, yup.AnySchema> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value instanceof yup.Schema) {
      result[key] = value;
    } else if (value != null && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = yup.object().shape(buildNestedShape(value as Record<string, unknown>));
    }
  }
  return result;
}

export interface FormWithValidationProps {
  defaultValues?: Record<string, unknown>;
  validationRules?: Record<string, ValidationRule>;
  submitAction?: string;
  runAction?: (action: { action: string }, event?: unknown) => void;
  setState?: (updater: (prev: Record<string, unknown>) => Record<string, unknown>) => void;
  children: React.ReactNode;
}

export function FormWithValidation({
  defaultValues = {},
  validationRules = {},
  submitAction,
  runAction,
  setState,
  children,
}: FormWithValidationProps) {
  const schema = Object.keys(validationRules).length > 0 ? buildYupSchema(validationRules) : undefined;
  const form = useForm({
    defaultValues: defaultValues as Record<string, string>,
    resolver: schema ? yupResolver(schema) : undefined,
    mode: 'onSubmit',
  });

  // Sync form values to store on every change so {{form.*}} interpolation updates live
  useEffect(() => {
    if (!setState) return;
    const unsubscribe = form.subscribe({
      formState: { values: true },
      callback: ({ values }) => {
        if (values) setState((prev) => ({ ...prev, ...values }));
      },
    });
    return unsubscribe;
  }, [form, setState]);

  const handleValidSubmit = (data: Record<string, unknown>) => {
    if (submitAction && runAction) {
      if (setState) {
        // data from react-hook-form is { form: { name, email, password, confirmPassword } }
        // Store form values at form.* for get("form.name") etc.
        const formData = (data.form as Record<string, unknown>) ?? data;
        setState((prev) => ({ ...prev, form: formData }));
      }
      runAction({ action: submitAction });
    }
  };

  const handleInvalidSubmit = () => {
    // Validation failed - errors are set by react-hook-form
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    e.stopPropagation();
    form.handleSubmit(handleValidSubmit, handleInvalidSubmit)(e);
  };

  const triggerSubmit = () => form.handleSubmit(handleValidSubmit, handleInvalidSubmit)();

  return (
    <FormProvider {...form}>
      <FormSubmitContext.Provider value={triggerSubmit}>
        <form onSubmit={handleSubmit} noValidate style={{ width: '100%' }} data-sdui-form>
          {children}
        </form>
      </FormSubmitContext.Provider>
    </FormProvider>
  );
}

const FormSubmitContext = createContext<(() => void) | null>(null);

export function useFormSubmit() {
  return useContext(FormSubmitContext);
}

/** Button that triggers form validation - use instead of type="submit" to avoid form submit interception */
export function FormSubmitButton(props: ComponentProps & { children?: React.ReactNode }) {
  const triggerSubmit = useFormSubmit();
  const { Button: Btn, ButtonText: BtnText } = require('@/components/ui/button');
  const { text = 'Submit', className, action = 'primary', children, ...rest } = props as {
    text?: string;
    className?: string;
    action?: string;
    children?: React.ReactNode;
    [k: string]: unknown;
  };
  const label = children ?? text;
  return React.createElement(
    Btn,
    {
      ...rest,
      type: 'button',
      action,
      className,
      onPress: triggerSubmit ?? undefined,
      onClick: triggerSubmit ?? undefined,
    },
    React.createElement(BtnText, null, label)
  );
}

export interface FormInputProps {
  name: string;
  placeholder?: string;
  secureTextEntry?: boolean;
  variant?: string;
  className?: string;
}

type ComponentProps = Record<string, unknown>;

export function FormInput({ name, placeholder, secureTextEntry, variant, className, ...rest }: FormInputProps) {
  return (
    <Controller
      name={name}
      render={({ field, fieldState }) => (
        <FormControl className={className}>
          <Input variant={variant as 'outline' | 'rounded' | 'underlined'} {...rest}>
            <InputField
              placeholder={placeholder}
              value={field.value ?? ''}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              secureTextEntry={secureTextEntry}
            />
          </Input>
          {fieldState.error && (
            <FormControlError>
              <FormControlErrorText>{fieldState.error.message}</FormControlErrorText>
            </FormControlError>
          )}
        </FormControl>
      )}
    />
  );
}

export function FormInputWithLabel(props: FormInputProps & { label?: string }) {
  const { name = '', label = '', placeholder, secureTextEntry, variant = 'outline', className } = props;
  if (!name) return null;
  return (
    <Controller
      name={name}
      render={({ field, fieldState }) => (
        <FormControl className={className} isInvalid={!!fieldState.error}>
          <FormControlLabel>
            <FormControlLabelText>{label}</FormControlLabelText>
          </FormControlLabel>
          <Input variant={variant as 'outline' | 'rounded' | 'underlined'}>
            <InputField
              placeholder={placeholder}
              value={field.value ?? ''}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              secureTextEntry={secureTextEntry}
            />
          </Input>
          {fieldState.error && (
            <Box className="mt-1">
              <Text className="text-error-700 text-sm">{fieldState.error.message}</Text>
            </Box>
          )}
        </FormControl>
      )}
    />
  );
}

/** Form wrapper for use in SDUI - renders FormWithValidation with JSON config */
export function SDUIForm(props: ComponentProps) {
  const {
    defaultValues = {},
    validationRules = {},
    submitAction,
    runAction,
    setState,
    children,
  } = props as FormWithValidationProps & { children?: React.ReactNode };

  if (!runAction || !submitAction) {
    return <form style={{ width: '100%' }}>{children}</form>;
  }

  return (
    <FormWithValidation
      defaultValues={defaultValues as Record<string, unknown>}
      validationRules={validationRules}
      submitAction={submitAction}
      runAction={runAction}
      setState={setState}
    >
      {children}
    </FormWithValidation>
  );
}
