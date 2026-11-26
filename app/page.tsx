import Link from "next/link";
export default function Landing() {
  return (
    <>
      <section className="card" style={{ marginTop: "1.5rem" }}>
        <h1>Online classes where only paid students join, and attendance is proven.</h1>
        <p className="muted">Students pay by M-Pesa, enter the lesson through Eduquench, and are verified by layered checks. Every change to a record is written to an audit trail nobody can edit.</p>
        <Link className="btn big" href="/sign-in">Sign in</Link>
      </section>
      <section className="card"><h2>How it works</h2>
        <ol><li>Your school enrols you and you pay by M-Pesa.</li><li>Tap Join at class time; Eduquench checks payment, device and time.</li><li>Enter the live code and answer short checks during the lesson.</li></ol>
      </section>
    </>
  );
}
