import { authClient } from "@/lib/auth-client";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import z from "zod/v4";
import Loader from "./loader";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, CheckCircle, XCircle } from "lucide-react";
import { useState } from "react";

// Strong password validation schema
const passwordSchema = z.string()
  .min(12, "Password must be at least 12 characters")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[0-9]/, "Password must contain at least one number")
  .regex(/[^a-zA-Z0-9]/, "Password must contain at least one special character")
  .refine((password) => {
    // Check for common weak patterns
    const weakPatterns = [
      /123456/, /password/, /qwerty/, /admin/, /letmein/,
      /welcome/, /monkey/, /dragon/, /master/, /login/
    ];
    return !weakPatterns.some(pattern => password.toLowerCase().match(pattern));
  }, "Password contains common weak patterns");

interface PasswordStrengthProps {
  password: string;
}

function PasswordStrength({ password }: PasswordStrengthProps) {
  const checks = [
    { test: password.length >= 12, label: "At least 12 characters" },
    { test: /[a-z]/.test(password), label: "One lowercase letter" },
    { test: /[A-Z]/.test(password), label: "One uppercase letter" },
    { test: /[0-9]/.test(password), label: "One number" },
    { test: /[^a-zA-Z0-9]/.test(password), label: "One special character" },
  ];

  return (
    <div className="space-y-2 mt-2">
      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Password requirements:</p>
      <div className="space-y-1">
        {checks.map((check, index) => (
          <div key={index} className="flex items-center space-x-2">
            {check.test ? (
              <CheckCircle className="w-4 h-4 text-green-500" />
            ) : (
              <XCircle className="w-4 h-4 text-gray-400" />
            )}
            <span className={`text-sm ${check.test ? 'text-green-600' : 'text-gray-500'}`}>
              {check.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SignUpForm({
  onSwitchToSignIn,
}: {
  onSwitchToSignIn: () => void;
}) {
  const router = useRouter();
  const { isPending } = authClient.useSession();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const form = useForm({
    defaultValues: {
      email: "",
      password: "",
      confirmPassword: "",
      name: "",
    },
    onSubmit: async ({ value }) => {
      await authClient.signUp.email(
        {
          email: value.email,
          password: value.password,
          name: value.name,
        },
        {
          onSuccess: () => {
            router.push("/");
            toast.success("Account created successfully! Welcome to TwentyFour/Seven.");
          },
          onError: (error) => {
            toast.error(error.error.message);
          },
        },
      );
    },
    validators: {
      onSubmit: z.object({
        name: z.string()
          .min(2, "Name must be at least 2 characters")
          .max(50, "Name must not exceed 50 characters")
          .regex(/^[a-zA-Z\s-']+$/, "Name can only contain letters, spaces, hyphens, and apostrophes"),
        email: z.string()
          .email("Please enter a valid email address")
          .max(100, "Email must not exceed 100 characters"),
        password: passwordSchema,
        confirmPassword: z.string(),
      }).refine((data) => data.password === data.confirmPassword, {
        message: "Passwords don't match",
        path: ["confirmPassword"],
      }),
    },
  });

  if (isPending) {
    return <Loader />;
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Create Account</h2>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Join TwentyFour/Seven to start streaming
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void form.handleSubmit();
        }}
        className="space-y-4"
      >
        <div>
          <form.Field name="name">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>Full Name</Label>
                <Input
                  id={field.name}
                  name={field.name}
                  type="text"
                  autoComplete="name"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  className="w-full"
                />
                {field.state.meta.errors.map((error) => (
                  <p key={error?.message} className="text-sm text-red-500">
                    {error?.message}
                  </p>
                ))}
              </div>
            )}
          </form.Field>
        </div>

        <div>
          <form.Field name="email">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>Email Address</Label>
                <Input
                  id={field.name}
                  name={field.name}
                  type="email"
                  autoComplete="email"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  className="w-full"
                />
                {field.state.meta.errors.map((error) => (
                  <p key={error?.message} className="text-sm text-red-500">
                    {error?.message}
                  </p>
                ))}
              </div>
            )}
          </form.Field>
        </div>

        <div>
          <form.Field name="password">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>Password</Label>
                <div className="relative">
                  <Input
                    id={field.name}
                    name={field.name}
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    className="w-full pr-10"
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-0 pr-3 flex items-center"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4 text-gray-400" />
                    ) : (
                      <Eye className="h-4 w-4 text-gray-400" />
                    )}
                  </button>
                </div>
                {field.state.value && <PasswordStrength password={field.state.value} />}
                {field.state.meta.errors.map((error) => (
                  <p key={error?.message} className="text-sm text-red-500">
                    {error?.message}
                  </p>
                ))}
              </div>
            )}
          </form.Field>
        </div>

        <div>
          <form.Field name="confirmPassword">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>Confirm Password</Label>
                <div className="relative">
                  <Input
                    id={field.name}
                    name={field.name}
                    type={showConfirmPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    className="w-full pr-10"
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-0 pr-3 flex items-center"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="h-4 w-4 text-gray-400" />
                    ) : (
                      <Eye className="h-4 w-4 text-gray-400" />
                    )}
                  </button>
                </div>
                {field.state.meta.errors.map((error) => (
                  <p key={error?.message} className="text-sm text-red-500">
                    {error?.message}
                  </p>
                ))}
              </div>
            )}
          </form.Field>
        </div>

        <form.Subscribe>
          {(state) => (
            <Button
              type="submit"
              className="w-full"
              disabled={!state.canSubmit || state.isSubmitting}
            >
              {state.isSubmitting ? "Creating Account..." : "Create Account"}
            </Button>
          )}
        </form.Subscribe>
      </form>

      <div className="text-center">
        <Button
          variant="link"
          onClick={onSwitchToSignIn}
          className="text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300"
        >
          Already have an account? Sign In
        </Button>
      </div>
    </div>
  );
}
