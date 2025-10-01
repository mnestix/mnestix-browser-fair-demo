import { useEffect } from 'react';
import { Reference, Submodel } from 'lib/api/aas/models';
import { useEnv } from 'app/EnvProvider';
import { LocalizedError } from 'lib/util/LocalizedError';
import { CurrentAasContextType, SubmodelOrIdReference } from 'components/contexts/CurrentAasContext';
import { SubmodelDescriptor } from 'lib/types/registryServiceTypes';
import { useShowError } from 'lib/hooks/UseShowError';
import { useAsyncEffect } from 'lib/hooks/UseAsyncEffect';
import { useAasStore } from 'stores/AasStore';
import {
    performFullAasSearch,
    performSubmodelSearch,
} from 'lib/services/infrastructure-search-service/infrastructureSearchActions';
import { getAasFromRepository } from 'lib/services/aas-repository-service/aasRepositoryActions';
import { encodeBase64 } from 'lib/util/Base64Util';

/**
 * Hook to load AAS content and its submodels asynchronously.
 * @param context
 * @param aasIdToLoad
 * @param repoUrl
 */
export function useAasLoader(context: CurrentAasContextType, aasIdToLoad: string, repoUrl: string | undefined) {
    const env = useEnv();
    const setIsLoadingAas = context.isLoadingAas[1];
    const setIsLoadingSubmodels = context.isLoadingSubmodels[1];
    const setAasOriginUrl = context.aasOriginUrl[1];
    const setSubmodels = context.submodelState[1];
    const [aasFromContext, setAasFromContext] = context.aasState;
    const [registryAasData, setRegistryAasData] = context.registryAasData;
    const [infrastructureName, setInfrastructureName] = context.infrastructureName;
    const { showError } = useShowError();
    const aasStore = useAasStore();

    const submodelWhitelist: string[] = JSON.parse(env.SUBMODEL_WHITELIST || '[]');

    function whitelistContains(sm: Submodel) {
        const semanticIds = sm.semanticId?.keys.map((key) => key.value);
        return semanticIds?.some((id) => submodelWhitelist.includes(id));
    }

    async function fetchSingleSubmodel(
        reference: Reference,
        infrastructureName: string,
        smDescriptor?: SubmodelDescriptor,
    ): Promise<SubmodelOrIdReference> {
        const submodelResponse = await performSubmodelSearch(reference, infrastructureName, smDescriptor);
        if (!submodelResponse.isSuccess) {
            return { id: reference.keys[0].value, error: submodelResponse.errorCode };
        }

        return {
            id: submodelResponse.result.searchResult.id,
            submodel: submodelResponse.result.searchResult,
            repositoryUrl: submodelResponse.result.location,
        };
    }

    async function fetchSubmodels(infrastructureName: string) {
        setIsLoadingSubmodels(true);
        if (aasFromContext?.submodels) {
            const sm_promises: Promise<SubmodelOrIdReference>[] = [];
            aasFromContext.submodels.map(async (smRef, i) => {
                const newSm_promise = fetchSingleSubmodel(
                    smRef,
                    infrastructureName,
                    registryAasData?.submodelDescriptors?.[i],
                );
                sm_promises.push(newSm_promise);
            });

            const updatePromises = sm_promises.map((smPromise) =>
                smPromise
                    .then((newSm) => {
                        setSubmodels((currentSubmodels) => {
                            if (currentSubmodels.some((sm) => sm.id === newSm.id)) {
                                return currentSubmodels;
                            }
                            if (
                                env.WHITELIST_FEATURE_FLAG &&
                                newSm.submodel &&
                                !whitelistContains(newSm.submodel)
                            ) {
                                return currentSubmodels;
                            }
                            return [...currentSubmodels, newSm];
                        });
                    })
                    .catch(() => undefined)
            );

            await Promise.allSettled(updatePromises);
        }
        setIsLoadingSubmodels(false);
    }

    async function loadAasContent() {
        if (repoUrl && infrastructureName) {
            const infrastructure = { infrastructureName: infrastructureName, url: repoUrl };
            const response = await getAasFromRepository(encodeBase64(aasIdToLoad), infrastructure);
            if (response.isSuccess) {
                setAasOriginUrl(repoUrl);
                setAasFromContext(response.result);
                setInfrastructureName(infrastructureName);
                return { success: true };
            }
        }

        const { isSuccess, result } = await performFullAasSearch(aasIdToLoad);
        if (!isSuccess) {
            showError(new LocalizedError('navigation.errors.urlNotFound'));
            return { success: false };
        }

        if (result.aas) {
            setAasOriginUrl(result.aasData?.aasRepositoryOrigin);
            setRegistryAasData(result.aasData ?? undefined);
            setAasFromContext(result.aas);
            setInfrastructureName(result.aasData?.infrastructureName ?? undefined);
            return { success: true };
        }

        return { success: false, redirectUrl: result.redirectUrl };
    }

    useEffect(() => {
        return () => {
            setSubmodels(new Array<SubmodelOrIdReference>());
        };
    }, []);

    useAsyncEffect(async () => {
        if (!infrastructureName) {
            setIsLoadingSubmodels(false);
            return;
        }
        await fetchSubmodels(infrastructureName);
    }, [aasFromContext]);

    useAsyncEffect(async () => {
        if (aasFromContext?.id === aasIdToLoad) return;
        const aasFromStore = aasStore.getAasData(aasIdToLoad);
        if (aasFromStore) {
            setAasFromContext(aasFromStore.aas);
            setAasOriginUrl(aasFromStore.aasData?.aasRepositoryOrigin);
            setRegistryAasData(aasFromStore.aasData);
            setInfrastructureName(aasFromStore.aasData?.infrastructureName || undefined);
            setIsLoadingAas(false); // initialized as true, so we need to set it to false here
            return;
        }
        setIsLoadingAas(true);
        await loadAasContent();
        setIsLoadingAas(false);
    }, [aasIdToLoad, env, repoUrl]);
}
