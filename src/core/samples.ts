/** Made-up example messages in the style of common scams. No real names, numbers or working links. */
export interface Sample {
  label: string
  text: string
}

export const SAMPLES: Sample[] = [
  {
    label: 'Parcel "invitation" file (Indonesian)',
    text: 'Selamat siang kak, paket atas nama kakak tidak bisa dikirim karena alamat kurang lengkap. Mohon cek foto resi di file berikut lalu konfirmasi hari ini juga ya, kalau tidak paket dikembalikan: Lihat_Foto_Paket.apk',
  },
  {
    label: 'Bank "security" code',
    text: 'URGENT: Your account has been locked due to unusual activity. To restore access, reply with the 6-digit code we just sent to your phone, or verify at http://secure-login.example-bank.co/verify?id=88213377. Failure to act within 30 minutes will suspend your card.',
  },
  {
    label: 'Easy job offer',
    text: 'Hi! I am Clara from HR. We reviewed your profile and you qualify for a remote part-time job: like videos for 20 minutes a day and earn $80 to $300 daily. No experience needed. To start, message our manager on Telegram @example_manager and pay the $15 training deposit.',
  },
  {
    label: 'Ordinary message',
    text: 'Hi, this is the dental clinic confirming your appointment on Thursday at 3 pm. Reply YES to confirm or call the front desk if you need to reschedule. Thank you!',
  },
]
