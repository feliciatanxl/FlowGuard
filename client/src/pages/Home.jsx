import NavBar from "../components/NavBar";
import Hero from "../components/Hero";
import ImpactStats from "../components/ImpactStats";
import FeatureCards from "../components/FeatureCards";
import Footer from "../components/Footer";
import LiveStatus from "../components/LiveStatus";
import Roadmap from "../components/Roadmap";
import HowItWorks from "../components/HowItWorks";
import FacilityWorkflow from "../components/FacilityWorkflow";
import HomepageCta from "../components/HomepageCta";

const Home = () => {
  return (
    <main>
      <NavBar />
      <Hero />
      <LiveStatus />
      <FeatureCards />
      <FacilityWorkflow />
      <ImpactStats />
      <HowItWorks />
      <Roadmap />
      <HomepageCta />
      <Footer />
    </main>
  );
};

export default Home;
