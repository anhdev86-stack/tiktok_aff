import { useSearch } from '@tanstack/react-router'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { AuthLayout } from '../auth-layout'
import { UserAuthForm } from './components/user-auth-form'

export function SignIn() {
  const { redirect } = useSearch({ from: '/(auth)/sign-in' })

  return (
    <AuthLayout>
      <Card className='border-border/60 shadow-xl'>
        <CardHeader className='space-y-1.5'>
          <CardTitle className='text-2xl font-semibold tracking-tight'>
            Đăng nhập
          </CardTitle>
          <CardDescription>
            Sử dụng tài khoản admin được cấp để truy cập console.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UserAuthForm redirectTo={redirect} />
        </CardContent>
      </Card>
      <p className='text-center text-xs text-muted-foreground'>
        Bạn không thể tự đăng ký — admin cấp tài khoản qua biến môi trường
        <code className='mx-1 rounded bg-muted px-1 py-0.5 text-[10px]'>
          ADMIN_*
        </code>
        .
      </p>
    </AuthLayout>
  )
}
