// Téléphone décoratif de l'accès à « Mes rendez-vous » (M3, maquette-mes-rendez-vous.pdf, 19/10) : il
// montre au patient à quoi ressemble le SMS qu'il va recevoir. Le code affiché est un exemple.

export function TelephoneSms({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`h-[32.5rem] w-[17.5rem] rounded-[2.625rem] bg-[#24332f] p-[0.6875rem] shadow-[0_40px_80px_-30px_rgb(0_20_30/0.6)] ${className ?? ''}`}
    >
      <div className="h-full rounded-[2rem] bg-[#f4f6f8] px-3.5 pt-14">
        <p className="mb-3.5 text-center text-xs text-muted-foreground">Messages · maintenant</p>
        <div className="rounded-[1.125rem] bg-white px-3.5 py-3 text-[0.8125rem] shadow-[0_6px_20px_-10px_rgb(0_0_0/0.25)]">
          <p className="mb-1 text-xs font-bold text-muted-foreground">CABINET</p>
          Votre code d’accès : 482913. Valable 10 minutes.
        </div>
      </div>
    </div>
  )
}
