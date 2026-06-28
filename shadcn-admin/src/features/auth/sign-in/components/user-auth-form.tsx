import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { Loader2, LogIn, User } from 'lucide-react'
import { toast } from 'sonner'
import { authApi } from '@/lib/api-endpoints'
import { handleServerError } from '@/lib/handle-server-error'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/password-input'

const formSchema = z.object({
  username: z.string().min(1, 'Vui lòng nhập username.'),
  password: z.string().min(1, 'Vui lòng nhập mật khẩu.'),
})

interface UserAuthFormProps extends React.HTMLAttributes<HTMLFormElement> {
  redirectTo?: string
}

export function UserAuthForm({
  className,
  redirectTo,
  ...props
}: UserAuthFormProps) {
  const navigate = useNavigate()
  const { auth } = useAuthStore()

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { username: '', password: '' },
  })

  const loginMut = useMutation({
    mutationFn: (data: z.infer<typeof formSchema>) =>
      authApi.login(data.username, data.password),
    onSuccess: (resp, vars) => {
      auth.setAccessToken(resp.accessToken)
      auth.setUser(resp.user ?? { username: vars.username, role: 'admin' })
      toast.success(`Welcome back, ${vars.username}!`)
      // Tránh redirect ngược về /sign-in (vòng lặp): nếu redirectTo trỏ về
      // /sign-in dưới mọi dạng → fallback về '/'.
      const safeRedirect =
        redirectTo && !redirectTo.includes('/sign-in') ? redirectTo : '/'
      navigate({ to: safeRedirect, replace: true })
    },
    onError: handleServerError,
  })

  const isPending = loginMut.isPending

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((d) => loginMut.mutate(d))}
        className={cn('grid gap-4', className)}
        {...props}
      >
        <FormField
          control={form.control}
          name='username'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Username</FormLabel>
              <FormControl>
                <div className='relative'>
                  <User
                    aria-hidden
                    className='pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground'
                  />
                  <Input
                    placeholder='admin'
                    autoComplete='username'
                    autoFocus
                    disabled={isPending}
                    className='ps-9'
                    {...field}
                  />
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='password'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <PasswordInput
                  placeholder='••••••••'
                  autoComplete='current-password'
                  disabled={isPending}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button
          type='submit'
          className='mt-1 h-10 w-full'
          disabled={isPending}
        >
          {isPending ? (
            <>
              <Loader2 className='me-2 size-4 animate-spin' />
              Đang xác thực...
            </>
          ) : (
            <>
              <LogIn className='me-2 size-4' />
              Đăng nhập
            </>
          )}
        </Button>
      </form>
    </Form>
  )
}
