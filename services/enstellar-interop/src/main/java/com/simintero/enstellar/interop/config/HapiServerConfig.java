package com.simintero.enstellar.interop.config;

import ca.uhn.fhir.context.FhirContext;
import ca.uhn.fhir.rest.api.EncodingEnum;
import ca.uhn.fhir.rest.server.RestfulServer;
import com.simintero.enstellar.interop.attachments.AttachDocumentOperation;
import com.simintero.enstellar.interop.dtr.QuestionnaireResourceProvider;
import com.simintero.enstellar.interop.dtr.QuestionnaireResponseResourceProvider;
import com.simintero.enstellar.interop.pas.PasClaimInquireProvider;
import com.simintero.enstellar.interop.pas.PasClaimSubmitProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.web.servlet.ServletRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.List;

@Configuration
public class HapiServerConfig {

    @Autowired private PasClaimSubmitProvider pasSubmitProvider;
    @Autowired private PasClaimInquireProvider pasInquireProvider;
    @Autowired private QuestionnaireResourceProvider questionnaireProvider;
    @Autowired private QuestionnaireResponseResourceProvider questionnaireResponseProvider;
    @Autowired private AttachDocumentOperation attachDocumentOperation;

    @Bean
    public RestfulServer fhirServer(FhirContext fhirContext) {
        RestfulServer server = new RestfulServer(fhirContext);
        server.setDefaultResponseEncoding(EncodingEnum.JSON);
        server.setDefaultPrettyPrint(false);

        server.registerProviders(List.of(
                pasSubmitProvider,
                pasInquireProvider,
                questionnaireProvider,
                questionnaireResponseProvider,
                attachDocumentOperation
        ));

        return server;
    }

    @Bean
    public ServletRegistrationBean<RestfulServer> hapiServletRegistration(RestfulServer fhirServer) {
        ServletRegistrationBean<RestfulServer> reg = new ServletRegistrationBean<>(fhirServer, "/fhir/*");
        reg.setName("hapiServer");
        reg.setLoadOnStartup(1);
        return reg;
    }
}
