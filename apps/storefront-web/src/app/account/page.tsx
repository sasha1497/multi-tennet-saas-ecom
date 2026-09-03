'use client';

import { useEffect, useState } from 'react';
import { Button, Card, CardBody, CardHeader, Input, useToast } from '@retailos/ui';
import { isApiClientError } from '@retailos/api-client';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store-context';

export default function ProfilePage() {
  const { customer } = useStore();
  const toast = useToast();

  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '' });
  const [passwords, setPasswords] = useState({ current: '', next: '' });
  const [saving, setSaving] = useState(false);
  const [changing, setChanging] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (customer) {
      setForm({
        firstName: customer.firstName,
        lastName: customer.lastName,
        email: customer.email ?? '',
        phone: customer.phone ?? '',
      });
    }
  }, [customer]);

  const save = async () => {
    setSaving(true);
    setErrors({});
    try {
      await api().storefront.updateProfile({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
      });
      toast.success('Profile updated');
    } catch (err) {
      if (isApiClientError(err)) {
        setErrors(err.fieldErrors);
        toast.error(err.message);
      } else {
        toast.error('Could not save your profile');
      }
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async () => {
    setChanging(true);
    try {
      await api().auth.changePassword({
        currentPassword: passwords.current,
        newPassword: passwords.next,
      });
      toast.success('Password changed', 'You have been signed out of other devices.');
      setPasswords({ current: '', next: '' });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change your password');
    } finally {
      setChanging(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Your details" />
        <CardBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="First name"
              value={form.firstName}
              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              error={errors.firstName}
            />
            <Input
              label="Last name"
              value={form.lastName}
              onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              error={errors.lastName}
            />
          </div>
          <Input
            label="Email address"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            error={errors.email}
          />
          <Input
            label="Mobile number"
            type="tel"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            error={errors.phone}
          />
          <div className="flex justify-end">
            <Button onClick={() => void save()} loading={saving}>
              Save changes
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Password" description="Changing it signs you out everywhere else." />
        <CardBody className="space-y-4">
          <Input
            label="Current password"
            type="password"
            autoComplete="current-password"
            value={passwords.current}
            onChange={(e) => setPasswords({ ...passwords, current: e.target.value })}
          />
          <Input
            label="New password"
            type="password"
            autoComplete="new-password"
            value={passwords.next}
            onChange={(e) => setPasswords({ ...passwords, next: e.target.value })}
            hint="At least 8 characters, with a letter and a number."
          />
          <div className="flex justify-end">
            <Button
              onClick={() => void changePassword()}
              loading={changing}
              disabled={!passwords.current || !passwords.next}
            >
              Change password
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
