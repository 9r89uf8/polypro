import DashboardClient from "./DashboardClient";

export default async function Page({ params }) {
    const { locationId } = await params;
    return <DashboardClient locationId={locationId} />;
}
